/**
 * The parent's choice to let Bin use the child's personalisation. Kept in this
 * browser per account and child, like Bin's history and the enrolled faces.
 * Changing the text of the notice changes the version and asks again.
 */
export const BUDDY_PERSONALIZE_VERSION = 'buddy-personalize-2026-11-20'

export const BUDDY_PERSONALIZE_NOTICE =
  'Bin sẽ biết tên gọi ở nhà, sở thích, cách giao tiếp, điều con nhạy cảm, cách giúp con bình tĩnh và mong muốn của bố mẹ trong hồ sơ cá nhân hoá. Các thông tin này được gửi kèm mỗi lượt trò chuyện đến Groq để tạo lời đáp, giống bản chép lời. Họ tên và kết quả sàng lọc không được gửi. Lựa chọn này chỉ lưu trên trình duyệt này.'

function consentKey(userId: string, childId: string) {
  return `aimbrace:buddy-personalize:v1:${encodeURIComponent(userId)}:${encodeURIComponent(childId)}`
}

/** True only for an answer given to the current version of the notice. */
export function loadBuddyPersonalize(userId: string, childId: string): boolean {
  if (!userId || !childId) return false
  try {
    const raw = localStorage.getItem(consentKey(userId, childId))
    const saved = raw ? (JSON.parse(raw) as { version?: unknown; on?: unknown }) : null
    return saved?.version === BUDDY_PERSONALIZE_VERSION && saved.on === true
  } catch {
    return false
  }
}

/** Saves the choice; false when the browser refused (private mode, full storage). */
export function saveBuddyPersonalize(userId: string, childId: string, on: boolean): boolean {
  if (!userId || !childId) return false
  try {
    if (on) {
      localStorage.setItem(consentKey(userId, childId), JSON.stringify({
        version: BUDDY_PERSONALIZE_VERSION,
        on: true,
        at: new Date().toISOString(),
      }))
    } else {
      localStorage.removeItem(consentKey(userId, childId))
    }
    return true
  } catch {
    return false
  }
}
