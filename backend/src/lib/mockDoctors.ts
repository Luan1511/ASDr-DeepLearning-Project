/**
 * Sample doctors for trying the "share a child's record with a doctor" flow
 * (DOCTOR_MODE=demo). They are NOT real people: every name and workplace is
 * invented, each account is flagged `isMock`, and the UI labels them as sample
 * data. Seed them with `npm run doctors:seed-mock`.
 */
import type { PrismaClient } from '@prisma/client'

export type MockDoctor = {
  /** Login e-mail of the sample account (reserved .local domain). */
  email: string
  displayName: string
  title: string
  specialty: string
  workplace: string
  city: string
  bio: string
  languages: string[]
  acceptingNew: boolean
}

export const MOCK_DOCTORS: MockDoctor[] = [
  {
    email: 'bs.minhanh@asdr.local',
    displayName: 'Trần Minh Anh',
    title: 'BS. CKI',
    specialty: 'Nhi khoa phát triển',
    workplace: 'Phòng khám mẫu Hoa Nắng',
    city: 'Đà Nẵng',
    bio: 'Theo dõi phát triển trẻ nhỏ, hướng dẫn phụ huynh quan sát các mốc vận động và giao tiếp của trẻ từ 1 đến 6 tuổi.',
    languages: ['Tiếng Việt', 'English'],
    acceptingNew: true,
  },
  {
    email: 'bs.quochuy@asdr.local',
    displayName: 'Lê Quốc Huy',
    title: 'ThS. BS.',
    specialty: 'Phục hồi chức năng nhi',
    workplace: 'Trung tâm mẫu Bước Nhỏ',
    city: 'Đà Nẵng',
    bio: 'Làm việc với trẻ có khó khăn về vận động thô và phối hợp động tác; quan tâm tới bài tập tại nhà cùng bố mẹ.',
    languages: ['Tiếng Việt'],
    acceptingNew: true,
  },
  {
    email: 'cv.thuha@asdr.local',
    displayName: 'Nguyễn Thu Hà',
    title: 'ThS. Tâm lý',
    specialty: 'Tâm lý lâm sàng trẻ em',
    workplace: 'Phòng tham vấn mẫu Mây Xanh',
    city: 'Hà Nội',
    bio: 'Đánh giá phát triển và đồng hành cùng gia đình trong can thiệp sớm; ưu tiên trao đổi rõ ràng, dễ hiểu với phụ huynh.',
    languages: ['Tiếng Việt', 'English'],
    acceptingNew: true,
  },
  {
    email: 'cv.baongoc@asdr.local',
    displayName: 'Phạm Bảo Ngọc',
    title: 'CN. Âm ngữ trị liệu',
    specialty: 'Âm ngữ trị liệu',
    workplace: 'Trung tâm mẫu Tiếng Cười',
    city: 'TP. Hồ Chí Minh',
    bio: 'Hỗ trợ trẻ chậm nói và trẻ giao tiếp bằng cử chỉ; hướng dẫn bố mẹ lồng trò chơi giao tiếp vào sinh hoạt hằng ngày.',
    languages: ['Tiếng Việt'],
    acceptingNew: true,
  },
  {
    email: 'cv.ducthinh@asdr.local',
    displayName: 'Võ Đức Thịnh',
    title: 'CN. Hoạt động trị liệu',
    specialty: 'Hoạt động trị liệu',
    workplace: 'Phòng trị liệu mẫu Cầu Vồng',
    city: 'TP. Hồ Chí Minh',
    bio: 'Tập trung vào điều hoà cảm giác, vận động tinh và kỹ năng tự phục vụ; thường xây kế hoạch ngắn theo từng tuần.',
    languages: ['Tiếng Việt', 'English'],
    acceptingNew: false,
  },
  {
    email: 'bs.kimlien@asdr.local',
    displayName: 'Đặng Kim Liên',
    title: 'BS. CKII',
    specialty: 'Tâm thần nhi',
    workplace: 'Phòng khám mẫu Bình Minh',
    city: 'Huế',
    bio: 'Khám và theo dõi lâu dài cho trẻ có khác biệt về phát triển thần kinh; phối hợp với giáo viên và chuyên viên trị liệu.',
    languages: ['Tiếng Việt', 'Français'],
    acceptingNew: true,
  },
  {
    email: 'gv.thanhtam@asdr.local',
    displayName: 'Hoàng Thanh Tâm',
    title: 'ThS. Giáo dục đặc biệt',
    specialty: 'Giáo dục đặc biệt',
    workplace: 'Lớp can thiệp mẫu Hạt Giống',
    city: 'Cần Thơ',
    bio: 'Xây dựng kế hoạch giáo dục cá nhân và hướng dẫn phụ huynh dạy trẻ kỹ năng bắt chước, luân phiên và chơi cùng bạn.',
    languages: ['Tiếng Việt'],
    acceptingNew: true,
  },
  {
    email: 'bs.giabao@asdr.local',
    displayName: 'Bùi Gia Bảo',
    title: 'TS. BS.',
    specialty: 'Thần kinh nhi',
    workplace: 'Phòng khám mẫu Sao Mai',
    city: 'Hà Nội',
    bio: 'Khám thần kinh nhi tổng quát, quan tâm tới vận động và dáng đi ở trẻ nhỏ; đọc kết quả sàng lọc cùng phụ huynh.',
    languages: ['Tiếng Việt', 'English'],
    acceptingNew: true,
  },
]

/**
 * Creates or refreshes the sample doctor accounts. Existing accounts keep
 * their password; `passwordHash` is only used for accounts created now.
 */
export async function seedMockDoctors(prisma: PrismaClient, passwordHash: string) {
  let created = 0
  let updated = 0
  for (const mock of MOCK_DOCTORS) {
    const profile = {
      displayName: mock.displayName,
      title: mock.title,
      specialty: mock.specialty,
      workplace: mock.workplace,
      city: mock.city,
      bio: mock.bio,
      languages: mock.languages,
      acceptingNew: mock.acceptingNew,
      isMock: true,
    }
    const existing = await prisma.user.findUnique({ where: { email: mock.email }, select: { id: true } })
    const user =
      existing ??
      (await prisma.user.create({
        data: { name: `${mock.title} ${mock.displayName}`, email: mock.email, passwordHash },
        select: { id: true },
      }))
    await prisma.doctorProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...profile }, update: profile })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated, total: MOCK_DOCTORS.length }
}
