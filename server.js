const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const port = Number(process.env.PORT || 8017);
const host = process.env.HOST || '127.0.0.1';
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
const legacyDataFile = path.join(dataDir, 'site-data.json');
const dbPath = path.join(dataDir, 'site.sqlite');
const maxBodySize = 9 * 1024 * 1024;
const sessions = new Map();
const roles = { owner: 'Главный администратор', manager: 'Менеджер', worker: 'Сотрудник' };
const statuses = ['Новая', 'В работе', 'Согласование', 'Завершена', 'Отказ'];
const types = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const clean = (value, limit = 2000) => String(value ?? '').trim().slice(0, limit);

let db;
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
function passwordMatches(password, stored) {
  const [salt, saved] = String(stored || '').split(':');
  if (!salt || !saved) return false;
  const current = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(saved, 'hex'), Buffer.from(current, 'hex'));
}
function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, login: row.login, role: row.role, active: Boolean(row.active), createdAt: row.created_at };
}
function initDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager','worker')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT,
      published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL, service TEXT NOT NULL DEFAULT 'Не указано',
      message TEXT NOT NULL DEFAULT '', call_time TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Новая',
      photo_url TEXT, assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  migrateLegacyData();
}
function setSetting(key, value) { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); }
function getSettings() { const rows = db.prepare('SELECT key, value FROM settings').all(); const saved = Object.fromEntries(rows.map((row) => [row.key, row.value])); return { title: saved.title || 'Вокруг участка', phone: saved.phone || '+7 900 000-00-00', email: saved.email || 'hello@vokrug-uchastka.ru' }; }
function seedDatabase() {
  const adminLogin = clean(process.env.ADMIN_USER || 'admin', 80);
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-password';
  const timestamp = now();
  db.prepare('INSERT INTO users (id,name,login,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id('user'), 'Главный администратор', adminLogin, hashPassword(adminPassword), 'owner', 1, timestamp, timestamp);
  setSetting('title', 'Вокруг участка'); setSetting('phone', '+7 900 000-00-00'); setSetting('email', 'hello@vokrug-uchastka.ru');
  const defaults = [
    ['Реставрация забора', 'Покраска и обновление древесины', '/assets/works/image (1).jpeg'],
    ['Монтаж и благоустройство', 'Материалы, основание, ограждения', '/assets/works/image (2).jpeg'],
    ['Материалы на участок', 'Песок, щебень, ПГС', '/assets/works/e9d2f7c6-0954-49c5-8bf1-16c081bc07a4.jpeg']
  ];
  const insertWork = db.prepare('INSERT INTO works (id,title,description,image_url,published,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
  for (const [title, description, imageUrl] of defaults) insertWork.run(id('work'), title, description, imageUrl, 1, timestamp, timestamp);
  migrateLegacyData();
}
function migrateLegacyData() {
  if (!fs.existsSync(legacyDataFile)) return;
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyDataFile, 'utf8'));
    for (const lead of legacy.leads || []) {
      if (db.prepare('SELECT id FROM leads WHERE id = ?').get(lead.id)) continue;
      db.prepare('INSERT INTO leads (id,created_at,updated_at,name,phone,service,message,call_time,status,photo_url) VALUES (?,?,?,?,?,?,?,?,?,?)').run(lead.id || id('lead'), lead.createdAt || now(), lead.updatedAt || now(), clean(lead.name, 120), clean(lead.phone, 80), clean(lead.service, 160) || 'Не указано', clean(lead.message, 2000), clean(lead.callTime, 160), statuses.includes(lead.status) ? lead.status : 'Новая', lead.photoUrl || null);
    }
  } catch (error) { console.error('Legacy migration skipped:', error.message); }
}
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key)); }
function sessionUser(req) { const token = parseCookies(req).vu_session; const session = token && sessions.get(token); if (!session || session.expiresAt < Date.now()) return null; const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(session.userId); return user || null; }
function setSession(res, userId) { const token = crypto.randomBytes(32).toString('base64url'); sessions.set(token, { userId, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14 }); res.setHeader('Set-Cookie', `vu_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600`); }
function clearSession(req, res) { const token = parseCookies(req).vu_session; if (token) sessions.delete(token); res.setHeader('Set-Cookie', 'vu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function can(user, action) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (user.role === 'manager') return ['leads:read','leads:update','works:read','works:write','settings:read'].includes(action);
  return ['leads:read','leads:update:assigned'].includes(action);
}
function send(res, status, body, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function error(res, status, message) { send(res, status, { error: message }); }
async function readJson(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > maxBodySize) throw new Error('Файл слишком большой. Максимум 8 МБ.'); chunks.push(chunk); } const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return {}; if (String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw)); return JSON.parse(raw); }
async function savePhoto(photo) { if (!photo?.dataUrl) return null; const match = String(photo.dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!match) throw new Error('Поддерживаются PNG, JPEG и WebP.'); const buffer = Buffer.from(match[2], 'base64'); if (buffer.length > 8 * 1024 * 1024) throw new Error('Файл слишком большой. Максимум 8 МБ.'); const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/webp' ? 'webp' : 'jpg'; const fileName = `photo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`; await fsp.writeFile(path.join(uploadDir, fileName), buffer); return `/uploads/${fileName}`; }
function leadRow(row) { return row && { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, name: row.name, phone: row.phone, service: row.service, message: row.message, callTime: row.call_time, status: row.status, photoUrl: row.photo_url, assignedUserId: row.assigned_user_id, assignedUserName: row.assigned_user_name || null }; }
function workRow(row) { return { id: row.id, title: row.title, description: row.description, imageUrl: row.image_url, published: Boolean(row.published) }; }
function getLeadById(leadId) { return db.prepare(`SELECT leads.*, users.name AS assigned_user_name FROM leads LEFT JOIN users ON users.id = leads.assigned_user_id WHERE leads.id = ?`).get(leadId); }
function requireUser(req, res) { const user = sessionUser(req); if (!user) { error(res, 401, 'Войдите в систему.'); return null; } return user; }
function requirePermission(req, res, permission) { const user = requireUser(req, res); if (!user) return null; if (!can(user, permission)) { error(res, 403, 'Недостаточно прав.'); return null; } return user; }
async function api(req, res, url) {
  const parts = url.pathname.slice(5).split('/').filter(Boolean); const [resource, recordId] = parts;
  if (resource === 'health') return send(res, 200, { ok: true, database: 'sqlite' });
  if (resource === 'auth') {
    if (recordId === 'setup' && req.method === 'GET') {
      const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      return send(res, 200, { needsSetup: userCount === 0 });
    }
    if (recordId === 'setup' && req.method === 'POST') {
      const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      if (userCount > 0) return error(res, 403, 'Владелец уже создан.');
      const input = await readJson(req);
      const name = clean(input.name, 120);
      const login = clean(input.login, 80).toLowerCase();
      const password = String(input.password || '');
      if (!name || !login || password.length < 10) return error(res, 422, 'Укажите имя, логин и пароль не менее 10 символов.');
      const timestamp = now();
      const owner = { id: id('user'), name, login, password_hash: hashPassword(password), role: 'owner', active: 1, created_at: timestamp, updated_at: timestamp };
      db.prepare('INSERT INTO users (id,name,login,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(owner.id, owner.name, owner.login, owner.password_hash, owner.role, owner.active, owner.created_at, owner.updated_at);
      setSetting('title', 'Вокруг участка');
      setSetting('phone', '+7 900 000-00-00');
      setSetting('email', 'hello@vokrug-uchastka.ru');
      setSession(res, owner.id);
      return send(res, 201, { user: publicUser(owner) });
    }    if (recordId === 'login' && req.method === 'POST') { const input = await readJson(req); const user = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(clean(input.login, 80)); if (!user || !passwordMatches(input.password, user.password_hash)) return error(res, 401, 'Неверный логин или пароль.'); setSession(res, user.id); return send(res, 200, { user: publicUser(user) }); }
    if (recordId === 'logout' && req.method === 'POST') { clearSession(req, res); return send(res, 200, { ok: true }); }
    if (recordId === 'me' && req.method === 'GET') { const user = sessionUser(req); return send(res, 200, { user: publicUser(user) }); }
  }
  if (resource === 'public' && recordId === 'works' && req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM works WHERE published = 1 ORDER BY created_at ASC').all().map(workRow));
  if (resource === 'public' && recordId === 'settings' && req.method === 'GET') return send(res, 200, getSettings());
  if (resource === 'leads' && req.method === 'POST' && !recordId) {
    const input = await readJson(req); if (clean(input.website, 120)) return error(res, 422, 'Заявка отклонена.'); const phone = clean(input.phone, 80); if (!phone) return error(res, 422, 'Укажите телефон.'); const photoUrl = await savePhoto(input.photo); const timestamp = now(); const lead = { id: id('lead'), createdAt: timestamp, updatedAt: timestamp, name: clean(input.name, 120), phone, service: clean(input.service, 160) || 'Не указано', message: clean(input.message, 2000), callTime: clean(input.callTime, 160), status: 'Новая', photoUrl }; db.prepare('INSERT INTO leads (id,created_at,updated_at,name,phone,service,message,call_time,status,photo_url) VALUES (?,?,?,?,?,?,?,?,?,?)').run(lead.id,timestamp,timestamp,lead.name,lead.phone,lead.service,lead.message,lead.callTime,lead.status,lead.photoUrl); return send(res, 201, lead);
  }
  if (resource === 'leads') {
    const user = requireUser(req, res); if (!user) return; if (req.method === 'GET' && !can(user, 'leads:read')) return error(res, 403, 'Недостаточно прав.'); if (req.method !== 'GET' && !(can(user, 'leads:update') || can(user, 'leads:update:assigned'))) return error(res, 403, 'Недостаточно прав.');
    if (!recordId && req.method === 'GET') { const query = user.role === 'worker' ? `WHERE leads.assigned_user_id = ?` : ''; const rows = db.prepare(`SELECT leads.*, users.name AS assigned_user_name FROM leads LEFT JOIN users ON users.id = leads.assigned_user_id ${query} ORDER BY leads.created_at DESC`).all(...(user.role === 'worker' ? [user.id] : [])); return send(res, 200, rows.map(leadRow)); }
    const current = getLeadById(recordId); if (!current) return error(res, 404, 'Заявка не найдена.'); if (user.role === 'worker' && current.assigned_user_id !== user.id) return error(res, 403, 'Эта заявка не назначена вам.');
    if (req.method === 'PATCH') { const input = await readJson(req); const assignedUserId = user.role === 'worker' ? current.assigned_user_id : (input.assignedUserId === '' ? null : input.assignedUserId ?? current.assigned_user_id); const status = statuses.includes(input.status) ? input.status : current.status; db.prepare('UPDATE leads SET name=?,phone=?,service=?,message=?,call_time=?,status=?,assigned_user_id=?,updated_at=? WHERE id=?').run(clean(input.name ?? current.name,120),clean(input.phone ?? current.phone,80),clean(input.service ?? current.service,160),clean(input.message ?? current.message,2000),clean(input.callTime ?? current.call_time,160),status,assignedUserId,now(),recordId); return send(res, 200, leadRow(getLeadById(recordId))); }
    if (req.method === 'DELETE') { if (!can(user, 'users:write')) return error(res, 403, 'Удалять заявки может только главный администратор.'); db.prepare('DELETE FROM leads WHERE id = ?').run(recordId); return send(res, 200, { ok: true }); }
  }
  if (resource === 'users') {
    const user = requirePermission(req, res, 'users:write'); if (!user) return;
    if (!recordId && req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(publicUser));
    if (!recordId && req.method === 'POST') { const input = await readJson(req); const login = clean(input.login,80).toLowerCase(); const password = String(input.password || ''); const role = Object.hasOwn(roles, input.role) ? input.role : 'worker'; if (!clean(input.name,120) || !login || password.length < 8) return error(res,422,'Укажите имя, логин и пароль не менее 8 символов.'); if (db.prepare('SELECT id FROM users WHERE login=?').get(login)) return error(res,409,'Такой логин уже существует.'); const timestamp=now(); const created={id:id('user'),name:clean(input.name,120),login,password_hash:hashPassword(password),role,active:input.active!==false,created_at:timestamp,updated_at:timestamp}; db.prepare('INSERT INTO users (id,name,login,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(created.id,created.name,created.login,created.password_hash,created.role,created.active?1:0,timestamp,timestamp); return send(res,201,publicUser(created)); }
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(recordId); if (!target) return error(res,404,'Сотрудник не найден.'); if (req.method === 'PATCH') { const input=await readJson(req); const role=Object.hasOwn(roles,input.role)?input.role:target.role; const active=input.active===undefined?target.active:Boolean(input.active); if (target.id===user.id && !active) return error(res,422,'Нельзя отключить собственный аккаунт.'); const hash=input.password?hashPassword(input.password):target.password_hash; db.prepare('UPDATE users SET name=?,login=?,role=?,active=?,password_hash=?,updated_at=? WHERE id=?').run(clean(input.name ?? target.name,120),clean(input.login ?? target.login,80).toLowerCase(),role,active?1:0,hash,now(),target.id); return send(res,200,publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(recordId))); }
  }
  if (resource === 'works') {
    const user = requirePermission(req,res, req.method==='GET'?'works:read':'works:write'); if (!user) return;
    if (!recordId && req.method==='GET') return send(res,200,db.prepare('SELECT * FROM works ORDER BY created_at ASC').all().map(workRow));
    if (!recordId && req.method==='POST') { const input=await readJson(req); const timestamp=now(); const work={id:id('work'),title:clean(input.title,120),description:clean(input.description,500),imageUrl:await savePhoto(input.image),published:input.published!==false}; db.prepare('INSERT INTO works (id,title,description,image_url,published,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(work.id,work.title,work.description,work.imageUrl,work.published?1:0,timestamp,timestamp); return send(res,201,work); }
    const current=db.prepare('SELECT * FROM works WHERE id=?').get(recordId); if(!current)return error(res,404,'Работа не найдена.'); if(req.method==='PATCH'){const input=await readJson(req); const imageUrl=input.image?.dataUrl?await savePhoto(input.image):current.image_url; db.prepare('UPDATE works SET title=?,description=?,image_url=?,published=?,updated_at=? WHERE id=?').run(clean(input.title ?? current.title,120),clean(input.description ?? current.description,500),imageUrl,input.published===undefined?current.published:(input.published?1:0),now(),recordId);return send(res,200,workRow(db.prepare('SELECT * FROM works WHERE id=?').get(recordId)));} if(req.method==='DELETE'){db.prepare('DELETE FROM works WHERE id=?').run(recordId);return send(res,200,{ok:true});}
  }
  if (resource === 'settings') { const user=requirePermission(req,res, req.method==='GET'?'settings:read':'settings:write'); if(!user)return; if(req.method==='GET')return send(res,200,getSettings()); if(req.method==='PUT'){const input=await readJson(req); setSetting('title',clean(input.title,100));setSetting('phone',clean(input.phone,80));setSetting('email',clean(input.email,160));return send(res,200,getSettings());} }
  error(res,404,'Не найдено.');
}
async function staticFile(req,res,url){let pathname=decodeURIComponent(url.pathname);if(pathname.startsWith('/data/')||pathname==='/data'||pathname.startsWith('/backups/')||pathname.startsWith('/.'))return error(res,404,'Не найдено.');if(pathname==='/admin') {res.writeHead(302,{Location:'/admin/'});return res.end();}if(pathname==='/')pathname='/index.html';if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,`.${pathname}`);if(!file.startsWith(root))return error(res,404,'Не найдено.');try{const stat=await fsp.stat(file);if(!stat.isFile())return error(res,404,'Не найдено.');send(res,200,await fsp.readFile(file),types[path.extname(file).toLowerCase()]||'application/octet-stream');}catch{return error(res,404,'Не найдено.');}}
initDatabase();
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);if(url.pathname.startsWith('/api/'))return await api(req,res,url);if(!['GET','HEAD'].includes(req.method))return error(res,405,'Метод не поддерживается.');return await staticFile(req,res,url);}catch(cause){console.error(cause);return error(res,400,cause.message||'Ошибка запроса.');}});
server.listen(port,host,()=>console.log(`Site started: http://${host}:${port}`));

