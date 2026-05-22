import React from 'react'
import { Sidebar } from '../components/Sidebar'
import { HeaderBar } from '../components/HeaderBar'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F4F6FB]">
      <div className="mx-auto flex max-w-[1400px] gap-0">
        {/* Fixed sidebar */}
        <div className="sticky top-0 h-screen overflow-y-auto py-4 pl-4">
          <Sidebar />
        </div>

        {/* Main scrollable area */}
        <main className="flex-1 min-w-0 px-6 py-4">
          <HeaderBar />
          <div className="mt-4">{children}</div>
          <footer className="mt-10 border-t border-slate-200 pt-4 pb-6 text-center text-xs text-slate-400">
            © 2025 ASDr. All rights reserved. &nbsp;·&nbsp;
            <a href="#" className="hover:text-[#6C63FF]">Chính sách bảo mật</a>
            &nbsp;·&nbsp;
            <a href="#" className="hover:text-[#6C63FF]">Điều khoản sử dụng</a>
            &nbsp;·&nbsp;
            <a href="#" className="hover:text-[#6C63FF]">Liên hệ</a>
          </footer>
        </main>
      </div>
    </div>
  )
}
