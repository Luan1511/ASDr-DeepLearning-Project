import { api } from './api'
import type {
  CommunityPost,
  CommunityPostsResponse,
  CommunityComment,
  PostCategory,
} from './communityTypes'

export async function fetchCommunityPosts(params?: {
  category?: string
  sort?: string
  search?: string
  page?: number
  limit?: number
}): Promise<CommunityPostsResponse> {
  const res = await api.get<CommunityPostsResponse>('/community/posts', { params })
  return res.data
}

export async function fetchCommunityPost(id: string): Promise<CommunityPost> {
  const res = await api.get<{ post: CommunityPost }>(`/community/posts/${id}`)
  return res.data.post
}

export async function createCommunityPost(data: {
  title: string
  content: string
  category: PostCategory
  isAnonymous: boolean
}): Promise<CommunityPost> {
  const res = await api.post<{ post: CommunityPost }>('/community/posts', data)
  return res.data.post
}

export async function updateCommunityPost(
  id: string,
  data: Partial<{ title: string; content: string; category: PostCategory }>,
): Promise<CommunityPost> {
  const res = await api.patch<{ post: CommunityPost }>(`/community/posts/${id}`, data)
  return res.data.post
}

export async function deleteCommunityPost(id: string): Promise<void> {
  await api.delete(`/community/posts/${id}`)
}

export async function toggleLikePost(id: string): Promise<{ liked: boolean; likesCount: number }> {
  const res = await api.post<{ liked: boolean; likesCount: number }>(`/community/posts/${id}/like`)
  return res.data
}

export async function toggleBookmarkPost(id: string): Promise<{ bookmarked: boolean }> {
  const res = await api.post<{ bookmarked: boolean }>(`/community/posts/${id}/bookmark`)
  return res.data
}

export async function fetchBookmarkedPosts(): Promise<CommunityPost[]> {
  const res = await api.get<{ posts: CommunityPost[] }>('/community/bookmarks')
  return res.data.posts
}

export async function createComment(
  postId: string,
  data: { content: string; isAnonymous: boolean; parentId?: string | null },
): Promise<CommunityComment> {
  const res = await api.post<{ comment: CommunityComment }>(`/community/posts/${postId}/comments`, data)
  return res.data.comment
}

export async function deleteComment(commentId: string): Promise<void> {
  await api.delete(`/community/comments/${commentId}`)
}

export async function togglePinPost(postId: string): Promise<boolean> {
  const res = await api.patch<{ success: boolean; isPinned: boolean }>(`/community/posts/${postId}/pin`)
  return res.data.isPinned
}
