import type { GaitView, JobStatus, ScreeningStatus } from './types'

export const SCREENING_STATUS_LABEL: Record<ScreeningStatus, string> = {
  UPLOADED: 'Đã tải lên',
  PROCESSING: 'Đang phân tích',
  COMPLETED: 'Hoàn tất',
  FAILED: 'Thất bại',
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: 'Đang chờ',
  RUNNING: 'Đang chạy',
  SUCCEEDED: 'Xong',
  FAILED: 'Lỗi',
}

export const GAIT_VIEW_LABEL: Record<GaitView, string> = {
  side: 'Quay ngang',
  frontal: 'Quay chính diện',
  oblique: 'Quay chéo',
  unknown: 'Không xác định',
}

export function formatNumber(value: number, digits = 1) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function formatPercent(value: number, digits = 0) {
  return `${formatNumber(value * 100, digits)}%`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} KB`
  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`
}
