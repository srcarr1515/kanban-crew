import { useMemo, useCallback, useState, type Ref } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IssueCommentsSection,
  type IssueCommentsEditorProps,
  type IssueCommentData,
  type ReactionGroup,
} from '@vibe/ui/components/IssueCommentsSection';
import WYSIWYGEditor, {
  type WYSIWYGEditorRef,
} from '@/shared/components/WYSIWYGEditor';
import {
  listTaskComments,
  createTaskComment,
  type TaskComment,
} from '@/shared/lib/local/localApi';

interface LocalIssueCommentsSectionContainerProps {
  issueId: string;
}

/**
 * Local-mode container for the comments section in the issue panel.
 * Fetches comments from the local API and maps them to IssueCommentData.
 */
export function LocalIssueCommentsSectionContainer({
  issueId,
}: LocalIssueCommentsSectionContainerProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['local', 'task-comments', issueId],
    [issueId],
  );

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => listTaskComments(issueId),
    enabled: Boolean(issueId),
    refetchInterval: 3000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { author_type: string; author_name: string; content: string }) =>
      createTaskComment(issueId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Map TaskComment to IssueCommentData
  const commentsData = useMemo<IssueCommentData[]>(() => {
    return (commentsQuery.data ?? [])
      .map((comment: TaskComment) => ({
        id: comment.id,
        authorId: null,
        authorName: comment.author_name,
        message: comment.content,
        createdAt: comment.created_at,
        author: comment.author_type === 'agent'
          ? { id: 'agent', first_name: comment.author_name, avatar_url: null }
          : null,
        canModify: false,
      }))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }, [commentsQuery.data]);

  // Empty reactions map (reactions not supported in local mode)
  const emptyReactions = useMemo(() => new Map<string, ReactionGroup[]>(), []);

  // Comment input state
  const [commentInput, setCommentInput] = useState('');

  const handleSubmitComment = useCallback(() => {
    if (!commentInput.trim()) return;
    createMutation.mutate({
      author_type: 'user',
      author_name: 'You',
      content: commentInput.trim(),
    });
    setCommentInput('');
  }, [commentInput, createMutation]);

  // No-op handlers for disabled features
  const noop = useCallback(() => {}, []);
  const noopString = useCallback((_: string) => {}, []);

  const renderEditor = useCallback(
    ({
      value,
      onChange,
      placeholder,
      className,
      disabled,
      autoFocus,
      onCmdEnter,
      onPasteFiles,
      editorRef,
    }: IssueCommentsEditorProps) => (
      <WYSIWYGEditor
        ref={editorRef as Ref<WYSIWYGEditorRef>}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoFocus={autoFocus}
        onCmdEnter={onCmdEnter}
        onPasteFiles={onPasteFiles}
      />
    ),
    [],
  );

  return (
    <IssueCommentsSection
      comments={commentsData}
      commentInput={commentInput}
      onCommentInputChange={setCommentInput}
      onSubmitComment={handleSubmitComment}
      editingCommentId={null}
      editingValue=""
      onEditingValueChange={noopString}
      onStartEdit={noopString}
      onSaveEdit={noop}
      onCancelEdit={noop}
      onDeleteComment={noopString}
      reactionsByCommentId={emptyReactions}
      onToggleReaction={noop as (commentId: string, emoji: string) => void}
      onReply={noop as (authorName: string, message: string) => void}
      isLoading={commentsQuery.isLoading}
      renderEditor={renderEditor}
    />
  );
}
