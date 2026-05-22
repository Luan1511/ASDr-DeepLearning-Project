import bcrypt from 'bcrypt'
import { PrismaClient, RiskLevel, ScreeningStatus, UserRole, Gender, ChatRole } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const adminEmail = 'admin@asdr.local'
  const userEmail = 'user@asdr.local'

  const adminPasswordHash = await bcrypt.hash('admin123', 10)
  const userPasswordHash = await bcrypt.hash('user123', 10)

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: 'Admin', passwordHash: adminPasswordHash, role: UserRole.ADMIN },
    create: { name: 'Admin', email: adminEmail, passwordHash: adminPasswordHash, role: UserRole.ADMIN },
  })

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: { name: 'Nguyễn Văn A', passwordHash: userPasswordHash, role: UserRole.USER },
    create: { name: 'Nguyễn Văn A', email: userEmail, passwordHash: userPasswordHash, role: UserRole.USER },
  })

  const child1Id = '11111111-1111-1111-1111-111111111111'
  const child2Id = '22222222-2222-2222-2222-222222222222'
  const video1Id = '33333333-3333-3333-3333-333333333333'
  const video2Id = '44444444-4444-4444-4444-444444444444'

  const child1 = await prisma.childProfile.upsert({
    where: { id: child1Id },
    update: {
      userId: user.id,
      fullName: 'Bé An',
      dateOfBirth: new Date('2022-06-10'),
      gender: Gender.FEMALE,
      note: 'Dữ liệu demo',
    },
    create: {
      id: child1Id,
      userId: user.id,
      fullName: 'Bé An',
      dateOfBirth: new Date('2022-06-10'),
      gender: Gender.FEMALE,
      note: 'Dữ liệu demo',
    },
  })

  const child2 = await prisma.childProfile.upsert({
    where: { id: child2Id },
    update: {
      userId: user.id,
      fullName: 'Bé Minh',
      dateOfBirth: new Date('2021-11-02'),
      gender: Gender.MALE,
      note: 'Dữ liệu demo',
    },
    create: {
      id: child2Id,
      userId: user.id,
      fullName: 'Bé Minh',
      dateOfBirth: new Date('2021-11-02'),
      gender: Gender.MALE,
      note: 'Dữ liệu demo',
    },
  })

  // Demo uploads + results (mock)
  await prisma.videoUpload.upsert({
    where: { id: video1Id },
    update: {
      userId: user.id,
      childId: child1.id,
      originalFilename: 'be-an-demo.mp4',
      storedFilename: 'demo-video-1.mp4',
      filePath: 'uploads/demo-video-1.mp4',
      mimeType: 'video/mp4',
      fileSize: 123_456_789,
      durationSeconds: 60,
      status: ScreeningStatus.COMPLETED,
    },
    create: {
      id: video1Id,
      userId: user.id,
      childId: child1.id,
      originalFilename: 'be-an-demo.mp4',
      storedFilename: 'demo-video-1.mp4',
      filePath: 'uploads/demo-video-1.mp4',
      mimeType: 'video/mp4',
      fileSize: 123_456_789,
      durationSeconds: 60,
      status: ScreeningStatus.COMPLETED,
      result: {
        create: {
          riskLevel: RiskLevel.MEDIUM,
          confidenceScore: 0.73,
          eyeContactScore: 0.62,
          motorPatternScore: 0.71,
          responseBehaviorScore: 0.68,
          repetitiveBehaviorScore: 0.55,
          recommendation:
            'Kết quả mang tính tham khảo. Nếu bạn lo lắng về sự phát triển của trẻ, hãy trao đổi với bác sĩ nhi/ chuyên gia tâm lý phát triển để được đánh giá trực tiếp.',
          rawAiResponse: { source: 'seed', version: 'mock-v1' },
        },
      },
    },
  })

  await prisma.videoUpload.upsert({
    where: { id: video2Id },
    update: {
      userId: user.id,
      childId: child2.id,
      originalFilename: 'be-minh-demo.mov',
      storedFilename: 'demo-video-2.mov',
      filePath: 'uploads/demo-video-2.mov',
      mimeType: 'video/quicktime',
      fileSize: 88_000_000,
      durationSeconds: 45,
      status: ScreeningStatus.COMPLETED,
    },
    create: {
      id: video2Id,
      userId: user.id,
      childId: child2.id,
      originalFilename: 'be-minh-demo.mov',
      storedFilename: 'demo-video-2.mov',
      filePath: 'uploads/demo-video-2.mov',
      mimeType: 'video/quicktime',
      fileSize: 88_000_000,
      durationSeconds: 45,
      status: ScreeningStatus.COMPLETED,
      result: {
        create: {
          riskLevel: RiskLevel.LOW,
          confidenceScore: 0.81,
          eyeContactScore: 0.78,
          motorPatternScore: 0.74,
          responseBehaviorScore: 0.80,
          repetitiveBehaviorScore: 0.70,
          recommendation:
            'Kết quả mang tính tham khảo. Tiếp tục theo dõi các mốc phát triển, duy trì tương tác tích cực và trao đổi với chuyên gia nếu có dấu hiệu bất thường.',
          rawAiResponse: { source: 'seed', version: 'mock-v1' },
        },
      },
    },
  })

  // Knowledge base articles
  const articles = [
    {
      title: 'ASD là gì?',
      slug: 'asd-la-gi',
      category: 'ASD',
      content:
        'ASD (Rối loạn phổ tự kỷ) là một nhóm các khác biệt về phát triển thần kinh, thường liên quan đến giao tiếp xã hội và hành vi/ sở thích lặp lại. Nội dung này chỉ mang tính tham khảo và không thay thế tư vấn y khoa.',
    },
    {
      title: 'Dấu hiệu sớm ở trẻ',
      slug: 'dau-hieu-som',
      category: 'Dấu hiệu',
      content:
        'Một số dấu hiệu có thể gồm: ít giao tiếp mắt, ít đáp ứng khi gọi tên, ít chia sẻ niềm vui, hành vi lặp lại... Nếu bạn lo lắng, hãy gặp chuyên gia để đánh giá trực tiếp.',
    },
    {
      title: 'Khi nào cần gặp chuyên gia?',
      slug: 'khi-nao-gap-chuyen-gia',
      category: 'Hướng dẫn',
      content:
        'Khi có lo ngại về giao tiếp, tương tác xã hội, hành vi lặp lại hoặc chậm mốc phát triển, nên trao đổi sớm với bác sĩ nhi hoặc chuyên gia tâm lý phát triển.',
    },
    {
      title: 'Can thiệp sớm',
      slug: 'can-thiep-som',
      category: 'Can thiệp',
      content:
        'Can thiệp sớm thường tập trung vào kỹ năng giao tiếp, tương tác, hành vi thích nghi; kế hoạch can thiệp cần cá nhân hoá dựa trên đánh giá của chuyên gia.',
    },
    {
      title: 'Cách chuẩn bị video để sàng lọc',
      slug: 'chuan-bi-video',
      category: 'Sàng lọc',
      content:
        'Gợi ý: quay trong môi trường đủ sáng, ghi rõ tương tác tự nhiên (chơi, gọi tên, trao đồ vật), video 3–10 phút, tránh chỉnh sửa/ lọc quá nhiều.',
    },
  ]

  for (const a of articles) {
    await prisma.article.upsert({
      where: { slug: a.slug },
      update: { title: a.title, content: a.content, category: a.category },
      create: a,
    })
  }

  // Seed a couple of chat messages as examples
  await prisma.chatMessage.createMany({
    data: [
      {
        userId: user.id,
        role: ChatRole.USER,
        content: 'ASD là gì?',
      },
      {
        userId: user.id,
        role: ChatRole.ASSISTANT,
        content:
          'ASD (Rối loạn phổ tự kỷ) là một nhóm các khác biệt về phát triển thần kinh. Thông tin chỉ mang tính tham khảo, không thay thế tư vấn bác sĩ/chuyên gia.',
      },
    ],
    skipDuplicates: true,
  })

  console.log('Seed completed:', { adminEmail, userEmail, child1: child1.fullName, child2: child2.fullName })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
