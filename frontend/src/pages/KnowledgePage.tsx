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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <Card title="Kiến thức (Knowledge Base)">
          <div className="text-sm text-slate-600">
            Tổng hợp bài viết tham khảo về ASD, dấu hiệu sớm và cách đồng hành cùng trẻ.
          </div>

          {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div className="mt-5 space-y-3">
            {(articles ?? []).map((a) => (
              <Link
                key={a.id}
                to={`/knowledge/${a.slug}`}
                className="block rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{a.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {a.category} • {new Date(a.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-indigo-700">Mở</div>
                </div>
              </Link>
            ))}

            {articles && articles.length === 0 && (
              <div className="rounded-2xl bg-white px-4 py-4 text-sm text-slate-500 ring-1 ring-slate-200">Không có dữ liệu.</div>
            )}
          </div>
        </Card>

        <Card title="Gợi ý sử dụng">
          <div className="space-y-2 text-sm leading-relaxed text-slate-600">
            <div>• Đọc kiến thức để hiểu ý nghĩa các chỉ số.</div>
            <div>• Kết quả AI chỉ mang tính tham khảo.</div>
            <div>• Nếu lo ngại, hãy trao đổi với chuyên gia.</div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  )
}
