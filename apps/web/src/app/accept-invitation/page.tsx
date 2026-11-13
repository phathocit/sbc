'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Container, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { api } from '@/lib/api';

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [email, setEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const invitationToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    if (!invitationToken) return;
    setToken(invitationToken);
    window.history.replaceState(null, '', '/accept-invitation');
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password.length < 12) { setError('Mật khẩu cần có ít nhất 12 ký tự.'); return; }
    if (password !== confirmation) { setError('Hai mật khẩu chưa khớp.'); return; }
    setSaving(true);
    try {
      await api.completeTenantInvitation({ token, password });
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể hoàn tất lời mời.');
    } finally { setSaving(false); }
  };

  const claimExistingAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.login({ email: email.trim(), password: loginPassword });
      const claim = await api.claimTenantInvitation({ token });
      localStorage.setItem('sbc_tenant_id', claim.tenantId);
      router.replace('/workspace');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể kết nối lời mời với tài khoản.');
    } finally { setSaving(false); }
  };

  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'radial-gradient(circle at 15% 5%, #27292e, #0D0F14 62%)', color: '#F5F7FA' }}>
    <Container size={460}>
      <Paper component="section" p="xl" radius="md" withBorder style={{ background: '#1F2430', borderColor: '#3a3f4b' }}>
        {complete ? <Stack align="center" gap="md"><Title order={1} style={{ color: '#F5F7FA' }}>Mật khẩu đã được tạo</Title><Text c="#bfc4ce" ta="center">Bạn có thể đăng nhập và mở workspace của tiệm.</Text><Button onClick={() => router.replace('/login')} style={{ background: '#E2C26B', color: '#0D0F14' }}>Đến trang đăng nhập</Button></Stack> : <form onSubmit={submit}>
          <Stack gap="md"><Text c="#E2C26B" size="sm" fw={700}>ZENBOOK · KÍCH HOẠT TÀI KHOẢN</Text><Title order={1} style={{ color: '#F5F7FA' }}>Tạo mật khẩu</Title><Text c="#bfc4ce">Lời mời chỉ dùng một lần và hết hạn sau 48 giờ.</Text>
            <PasswordInput label="Mật khẩu mới" value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="new-password" minLength={12} maxLength={128} required styles={{ input: { color: '#F5F7FA', background: '#151922', borderColor: '#464C58' }, label: { color: '#F5F7FA' } }} />
            <PasswordInput label="Nhập lại mật khẩu" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="new-password" maxLength={128} required styles={{ input: { color: '#F5F7FA', background: '#151922', borderColor: '#464C58' }, label: { color: '#F5F7FA' } }} />
            {error && <Text role="alert" c="#ffaaa5" size="sm">{error}</Text>}
            {!token && <Text role="alert" c="#ffaaa5" size="sm">Liên kết mời không đầy đủ. Hãy mở liên kết trong email hoặc liên hệ hỗ trợ.</Text>}
            <Button type="submit" loading={saving} disabled={!token || saving} style={{ background: '#E2C26B', color: '#0D0F14' }}>Tạo mật khẩu và kích hoạt</Button>
          </Stack>
        </form>}
        {!complete && token && <Stack mt="lg" gap="sm">
          <Text c="#bfc4ce" size="sm" ta="center">Bạn đã có tài khoản ZenBook?</Text>
          {mode === 'new' ? <Button variant="subtle" color="yellow" onClick={() => setMode('existing')}>Đăng nhập để nhận quyền chủ tiệm</Button> : <>
            <form onSubmit={claimExistingAccount}><Stack gap="sm">
              <Text c="#bfc4ce" size="sm">Đăng nhập bằng đúng email đã nhận lời mời. Lời mời sẽ được gắn vào tài khoản hiện có mà không đổi mật khẩu.</Text>
              <input type="email" required autoComplete="username" placeholder="Email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} style={{ padding: 12, color: '#F5F7FA', background: '#151922', border: '1px solid #464C58', borderRadius: 8 }} />
              <input type="password" required autoComplete="current-password" placeholder="Mật khẩu ZenBook" value={loginPassword} onChange={(event) => setLoginPassword(event.currentTarget.value)} style={{ padding: 12, color: '#F5F7FA', background: '#151922', border: '1px solid #464C58', borderRadius: 8 }} />
              <Button type="submit" loading={saving} disabled={saving} style={{ background: '#E2C26B', color: '#0D0F14' }}>Đăng nhập và nhận lời mời</Button>
              <Button type="button" variant="subtle" color="gray" onClick={() => setMode('new')}>Tạo tài khoản mới bằng lời mời</Button>
            </Stack></form>
          </>}
        </Stack>}
      </Paper>
    </Container>
  </main>;
}
