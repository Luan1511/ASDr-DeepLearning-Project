require('dotenv/config')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const database = new URL(process.env.DATABASE_URL)
assert(['localhost','127.0.0.1'].includes(database.hostname) && database.port === '5435')
const users=[]
let browser
async function user(role) {
  const row=await prisma.user.create({data:{name:'Permission check',email:`${randomUUID()}@example.test`,passwordHash:'!test-only',role}})
  users.push(row.id)
  return {id:row.id,token:jwt.sign({name:row.name,email:row.email,role},process.env.JWT_SECRET,{subject:row.id,expiresIn:'10m'})}
}
async function call(path,actor,method='GET',body) {
  const response=await fetch(`http://localhost:4000/api${path}`,{method,headers:{Authorization:`Bearer ${actor.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
  return {status:response.status,data:await response.json()}
}
async function main() {
  const a=await user('USER'),b=await user('USER'),admin=await user('ADMIN')
  const create=async()=>{const result=await call('/community/posts',a,'POST',{title:`Permission post ${randomUUID()}`,content:'Permissions integration example content',category:'STORY'});assert.equal(result.status,201);return result.data.post}
  const post=await create()
  assert.equal(post.canEdit,true);assert.equal(post.canDelete,true)
  const path=`/community/posts/${post.id}`
  for(const [actor,canEdit,canDelete] of [[a,true,true],[b,false,false],[admin,false,true]]) {
    const dto=(await call(path,actor)).data.post
    assert.equal(dto.canEdit,canEdit);assert.equal(dto.canDelete,canDelete)
    const feed=(await call('/community/posts',actor)).data.posts.find((row)=>row.id===post.id)
    assert.equal(feed.canEdit,canEdit);assert.equal(feed.canDelete,canDelete)
    await call(`${path}/bookmark`,actor,'POST')
    const bookmark=(await call('/community/bookmarks',actor)).data.posts.find((row)=>row.id===post.id)
    assert.equal(bookmark.canEdit,canEdit);assert.equal(bookmark.canDelete,canDelete)
  }
  assert.equal((await call(path,b,'PATCH',{title:'Unauthorized edit'})).status,403)
  assert.equal((await call(path,admin,'PATCH',{title:'Unauthorized admin edit'})).status,403)
  assert.equal((await call(`${path}/pin`,admin,'PATCH')).status,403)
  assert.equal((await call(path,b,'DELETE')).status,403)
  assert.equal((await call(path,a,'PATCH',{content:'Author updated this example content'})).status,200)
  const comment=await call(`${path}/comments`,a,'POST',{content:'Own anonymous comment',isAnonymous:true})
  assert.equal(comment.status,201)
  const before=(await call(path,a)).data.post.commentsCount
  const self=await call(`${path}/comments`,a,'POST',{content:'Self reply forbidden',parentId:comment.data.comment.id})
  assert.equal(self.status,400);assert.equal(self.data.error,'CANNOT_REPLY_TO_SELF')
  assert.equal((await call(path,a)).data.post.commentsCount,before)
  assert.equal((await call(`${path}/comments`,b,'POST',{content:'Other parent reply allowed',parentId:comment.data.comment.id})).status,201)
  if(process.env.CHECK_BROWSER==='1') {
    const {chromium}=require(require('node:path').join(process.env.TEMP,'aimbrace-chat-browser-check/node_modules/playwright-core'))
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',timeout:20000})
    for(const [actor,canEdit,canDelete] of [[a,true,true],[b,false,false],[admin,false,true]]) {
      const context=await browser.newContext()
      await context.addInitScript((token)=>localStorage.setItem('asdr_token',token),actor.token)
      const page=await context.newPage();page.setDefaultTimeout(15000)
      await page.goto('http://localhost:5173/community')
      const card=page.getByRole('article').filter({hasText:post.title})
      await card.getByRole('button',{name:'Tuỳ chọn',exact:true}).click()
      assert.equal(await card.getByRole('button',{name:'Sửa bài viết',exact:true}).count(),canEdit?1:0)
      assert.equal(await card.getByRole('button',{name:'Xoá bài viết',exact:true}).count(),canDelete?1:0)
      await page.goto(`http://localhost:5173/community/post/${post.id}`)
      await page.getByText('Own anonymous comment',{exact:true}).waitFor()
      assert.equal(await page.getByRole('button',{name:'Trả lời',exact:true}).count(),actor.id===a.id?0:1)
      await context.close()
    }
    console.log('PASS browser: owner/other/admin edit-delete controls and own comment reply hidden')
  }
  assert.equal((await call(path,admin,'DELETE')).status,200)
  const own=await create()
  assert.equal((await call(`/community/posts/${own.id}`,a,'DELETE')).status,200)
  console.log('PASS API: owner-only editing, owner/admin deletion, view-only management for other parents, own anonymous reply rejected without counter changes')
}
main().catch((error)=>{console.error(error);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect()})
