import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import type { Article } from '../lib/types'

export function ArticlePage() {
  const { slug } = useParams()
  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    api
      .get(`/articles/${slug}`)
      .then((res) => setArticle(res.data.article))
      .catch(() => setError('Không tải được nội dung bài viết.'))
  }, [slug])

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <Link to="/knowledge" className="link-duo text-sm">
          ← Quay lại
        </Link>
        <Card title={article?.title ?? 'Bài viết'}>
          {error && <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-duo-red">{error}</div>}
          {!error && !article && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
          {article && (
            <>
              <div className="text-xs font-bold uppercase tracking-wide text-duo-mute">
                {article.category} • {new Date(article.createdAt).toLocaleDateString('vi-VN')}
              </div>
              <div className="mt-4 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-duo-ink">{article.content}</div>
            </>
          )}
        </Card>
      </div>
    </DashboardLayout>
  )
}
