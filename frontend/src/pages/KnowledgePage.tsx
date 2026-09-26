import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import type { Article } from '../lib/types'

export function KnowledgePage() {
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/articles')
      .then((res) => setArticles(res.data.articles))
      .catch(() => {
        setError('Không tải được bài viết.')
        setArticles([])
      })
  }, [])

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Kiến thức ASD</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">Bài viết ngắn, dễ đọc — không thay thế tư vấn chuyên gia.</p>
        </div>

        {error && <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-duo-red">{error}</div>}

        {(articles ?? []).map((a) => (
          <Link key={a.id} to={`/knowledge/${a.slug}`} className="card-duo block px-5 py-4 hover:bg-duo-mist">
            <div className="text-base font-extrabold text-duo-ink">{a.title}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-wide text-duo-mute">
              {a.category} • {new Date(a.createdAt).toLocaleDateString('vi-VN')}
            </div>
          </Link>
        ))}

        {articles && articles.length === 0 && (
          <Card>
            <div className="text-sm font-semibold text-duo-mute">Không có dữ liệu.</div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
