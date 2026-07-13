import { Router } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

// POST /api/auth  { username }
router.post('/auth', (req, res) => {
  if (req.session.userId) {
    return res.json({
      username: req.session.username,
      avatar:   req.session.avatar   ?? null,
      existing: true,
    });
  }

  const { username } = req.body;

  if (!username?.trim()) return res.status(400).json({ error: '닉네임을 입력해주세요.' });

  const name = username.trim().slice(0, 16);

  if (/\s/.test(name))  return res.status(400).json({ error: '닉네임에 띄어쓰기를 사용할 수 없습니다.' });
  if (name.length  < 2) return res.status(400).json({ error: '닉네임은 2자 이상이어야 합니다.' });

  req.session.userId   = randomUUID();
  req.session.username = name;
  req.session.avatar   = null;
  res.json({ username: name, avatar: null, existing: false });
});

// GET /api/me
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'not_logged_in' });

  res.json({
    id:       req.session.userId,
    username: req.session.username,
    avatar:   req.session.avatar   ?? null,
  });
});

// PUT /api/me/username  { username: '...' }
router.put('/me/username', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'not_logged_in' });

  const name = req.body.username?.trim().slice(0, 16);
  if (!name || name.length < 2) return res.status(400).json({ error: '닉네임은 2자 이상 16자 이하여야 합니다.' });
  if (/\s/.test(name)) return res.status(400).json({ error: '닉네임에 띄어쓰기를 사용할 수 없습니다.' });

  req.session.username = name;
  res.json({ username: name });
});

// PUT /api/me/avatar  { avatar: '<base64>' }
router.put('/me/avatar', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'not_logged_in' });

  const { avatar } = req.body;
  if (!avatar || typeof avatar !== 'string') return res.status(400).json({ error: '이미지 데이터가 없습니다.' });
  if (!avatar.startsWith('data:image/')) return res.status(400).json({ error: '올바른 이미지 형식이 아닙니다.' });

  // base64 부분만 추출해서 크기 확인 (~200KB 제한)
  const base64Data = avatar.split(',')[1] ?? '';
  if (base64Data.length > 280_000) return res.status(400).json({ error: '이미지 크기가 너무 큽니다. (최대 200KB)' });

  req.session.avatar = avatar;
  res.json({ avatar });
});

export default router;
