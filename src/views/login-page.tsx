import { useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'
import { InstallAppButton } from '@/components/shared/install-app'
import {
  LoginAuthFeedback,
  type LoginAuthStatus,
} from '@/components/shared/login-auth-feedback'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { FadeIn } from '@/components/shared/page-transition'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { useAuth } from '@/contexts/auth-context'
import { authService } from '@/services/api'
import { USE_MOCK_API } from '@/services/api/client'
import { ApiClientError } from '@/services/api/http-client'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { isStudentNumberIdentifier } from '@/lib/student-portal'

const loginSchema = z.object({
  email: z.string().min(1, 'Email or student number is required'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean(),
})

type LoginValues = z.infer<typeof loginSchema>

const MIN_LOADING_MS = 900
const SUCCESS_HOLD_MS = 1400
const ERROR_HOLD_MS = 2200

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'ACCOUNT_SUSPENDED') return err.message
    return err.message || 'Invalid email or password'
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code)
    const message =
      'message' in err && typeof (err as { message: unknown }).message === 'string'
        ? (err as { message: string }).message
        : ''
    if (code === 'ACCOUNT_SUSPENDED') {
      return message || 'Your account is currently suspended.'
    }
    if (code === 'auth/user-disabled') {
      return 'Your account is currently suspended. Contact your school administrator.'
    }
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/user-not-found'
    ) {
      return 'Invalid email or password'
    }
  }
  if (err instanceof Error && err.message) return err.message
  return 'Invalid email or password'
}

export function LoginPage() {
  const { user, login, requestPasswordReset } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [authStatus, setAuthStatus] = useState<LoginAuthStatus>('idle')
  const [feedbackMessage, setFeedbackMessage] = useState<string | undefined>()
  const [resetting, setResetting] = useState(false)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      remember: true,
    },
  })

  const busy = authStatus !== 'idle' || resetting

  if (user && authStatus === 'idle') return <Navigate to="/dashboard" replace />

  async function onSubmit(values: LoginValues) {
    const startedAt = Date.now()
    setFeedbackMessage(undefined)
    flushSync(() => {
      setAuthStatus('loading')
    })

    try {
      await login(values.email.trim(), values.password, values.remember)
      const remaining = MIN_LOADING_MS - (Date.now() - startedAt)
      if (remaining > 0) await wait(remaining)
      flushSync(() => {
        setAuthStatus('success')
      })
      await wait(SUCCESS_HOLD_MS)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const remaining = MIN_LOADING_MS - (Date.now() - startedAt)
      if (remaining > 0) await wait(remaining)
      const message = loginErrorMessage(err)
      flushSync(() => {
        setFeedbackMessage(message)
        setAuthStatus('error')
      })
      await wait(ERROR_HOLD_MS)
      setAuthStatus('idle')
      setFeedbackMessage(undefined)
    }
  }

  function handleSubmit(e: FormEvent) {
    void form.handleSubmit(onSubmit)(e)
  }

  async function handleForgotPassword() {
    const email = form.getValues('email').trim()
    if (!email) {
      form.setError('email', { message: 'Enter your email first' })
      return
    }
    if (isStudentNumberIdentifier(email)) {
      notify.info(
        'Students: get a new portal code from the school office. Codes are issued monthly once fees are cleared.',
      )
      return
    }
    setResetting(true)
    try {
      await notify.process(() => requestPasswordReset(email), {
        loading: 'Sending reset email…',
        success: 'If that account exists, a password reset link was sent to your email',
        error: 'Could not send reset email',
      })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27 viewBox=%270 0 48 48%27%3E%3Cpath fill=%27%230b3d5c%27 fill-opacity=%270.035%27 d=%27M0 0h1v48H0zm47 0h1v48h-1zM0 0h48v1H0zm0 47h48v1H0z%27/%3E%3C/svg%3E')]" />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="relative mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-3 pb-8 pt-16 sm:px-4 sm:py-10 lg:grid-cols-2">
        <FadeIn className="hidden lg:block">
          <BrandMark subtitle="School Management System" />
          <h1 className="mt-8 max-w-xl font-display text-4xl font-semibold tracking-tight text-foreground xl:text-5xl">
            Your school.
            <br />
            Connected. Simplified.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
            Manage your school operations, academics, students, attendance, fees and results — all
            in one place.
          </p>
          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-card">
            <div className="rounded-xl bg-accent/10 p-2.5 text-accent">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                {USE_MOCK_API ? 'Demo sign-in' : 'Secure school access'}
              </p>
              <p className="text-xs text-muted-foreground">
                {USE_MOCK_API
                  ? 'Using local demo users for UI development.'
                  : 'Authorized staff and students can securely access their Viste High School portal from here.'}
              </p>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.08}>
          <Card
            className={cn(
              'relative mx-auto w-full max-w-md border-border/70 shadow-elevated hover:shadow-elevated',
              busy && 'pointer-events-none',
            )}
          >
            <CardHeader className="space-y-3">
              <div className="lg:hidden">
                <BrandMark subtitle="School Management System" />
              </div>
              <CardTitle className="text-2xl">Welcome back</CardTitle>
              <CardDescription>Sign in to access your Viste High School account.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Field>
                  <Label htmlFor="email">Email address or student number</Label>
                  <Input
                    id="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    disabled={busy}
                    {...form.register('email')}
                    placeholder="Enter your email or student number"
                  />
                  {form.formState.errors.email && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.email.message}
                    </p>
                  )}
                </Field>

                <Field>
                  <Label htmlFor="password">Password or portal code</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password or portal code"
                      className="pr-11"
                      disabled={busy}
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      disabled={busy}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.password.message}
                    </p>
                  )}
                </Field>

                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.watch('remember')}
                      onCheckedChange={(v) => form.setValue('remember', v === true)}
                      disabled={busy}
                    />
                    Remember me
                  </label>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void handleForgotPassword()}
                  >
                    Forgot password?
                  </button>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  loading={authStatus === 'loading'}
                  disabled={busy}
                >
                  Sign in
                </Button>
              </form>

              <InstallAppButton className="mt-4 flex justify-center" />

              {USE_MOCK_API ? (
                <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/40 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
                    Development credentials only
                  </p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {authService.getDemoCredentials().map((cred) => (
                      <li
                        key={cred.email}
                        className="rounded-xl border border-border/60 bg-card px-3 py-2.5 transition-colors hover:border-primary/20"
                      >
                        <span className="block font-semibold">{cred.label}</span>
                        <span className="text-muted-foreground">
                          {cred.email} · {cred.password}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </FadeIn>
      </div>

      {authStatus !== 'idle' ? (
        <LoginAuthFeedback status={authStatus} message={feedbackMessage} />
      ) : null}
    </div>
  )
}
