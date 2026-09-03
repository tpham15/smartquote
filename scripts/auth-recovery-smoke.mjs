import fs from 'node:fs';

const gate = fs.readFileSync('src/supabase/SupabaseAuthGate.jsx', 'utf8');
const cloud = fs.readFileSync('src/supabase/cloudState.js', 'utf8');

function must(text, pattern, label) {
  if (!text.includes(pattern)) {
    throw new Error(`Missing ${label}: ${pattern}`);
  }
}

must(gate, 'Quên mật khẩu?', 'forgot password button');
must(gate, 'mode === "forgot"', 'forgot mode');
must(gate, 'PASSWORD_RECOVERY', 'Supabase password recovery event handler');
must(gate, 'mode === "update_password"', 'update password mode');
must(gate, 'Gửi link đặt lại mật khẩu', 'reset link submit label');
must(gate, 'Cập nhật mật khẩu', 'new password submit label');
must(gate, 'passwordResetRedirectUrl()', 'redirect URL helper usage');
must(cloud, 'requestPasswordReset', 'password reset cloud helper');
must(cloud, 'resetPasswordForEmail', 'Supabase resetPasswordForEmail');
must(cloud, 'updateCurrentUserPassword', 'update password helper');
must(cloud, 'updateUser({ password })', 'Supabase updateUser password call');

console.log('Auth recovery smoke: PASS');
