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
      <div className="space-y-6">
        <div>
          <Link to="/knowledge" className="text-sm font-semibold text-indigo-700">
            ← Quay lại Knowledge Base
          </Link>
        </div>

        <Card title={article?.title ?? 'Bài viết'}>
          {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          {!error && !article && <div className="text-sm text-slate-500">Đang tải...</div>}
          {article && (
            <>
              <div className="text-xs text-slate-500">
                {article.category} • {new Date(article.createdAt).toLocaleDateString()}
              </div>
              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{article.content}</div>
            </>
          )}
        </Card>
      </div>
    </DashboardLayout>
  )
}
