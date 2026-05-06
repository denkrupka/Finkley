import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'
import { FacebookButton } from './FacebookButton'
import { GoogleButton } from './GoogleButton'
import { TelegramLoginWidget } from './TelegramLoginWidget'

const schema = z.object({
  email: z.string().min(1, 'auth.errors.email_required').email('auth.errors.email_invalid'),
  password: z.string().min(1, 'auth.errors.password_required'),
})

type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const { t } = useTranslation()
  const { signInWithPassword } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)

  const fromState = (location.state as { from?: { pathname?: string } } | null)?.from
  const targetAfterLogin = fromState?.pathname ?? '/'

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const { error } = await signInWithPassword(values.email, values.password)
    if (error) {
      const code = (error as { code?: string }).code
      const isCredentials = code === 'invalid_credentials' || /invalid login/i.test(error.message)
      setServerError(isCredentials ? t('auth.errors.invalid_credentials') : error.message)
      return
    }
    navigate(targetAfterLogin, { replace: true })
  }

  return (
    <AuthLayout
      title={t('auth.login.title')}
      footer={
        <>
          {t('auth.login.no_account')}{' '}
          <Link
            to="/signup"
            className="text-secondary font-semibold hover:underline"
            data-testid="signup-link"
          >
            {t('auth.login.signup_link')}
          </Link>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        data-testid="login-form"
      >
        <Field
          id="email"
          label={t('auth.login.email_label')}
          error={
            form.formState.errors.email?.message ? t(form.formState.errors.email.message) : null
          }
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!form.formState.errors.email}
            {...form.register('email')}
          />
        </Field>

        <Field
          id="password"
          label={t('auth.login.password_label')}
          error={
            form.formState.errors.password?.message
              ? t(form.formState.errors.password.message)
              : null
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register('password')}
          />
        </Field>

        {serverError ? (
          <p className="text-destructive text-sm font-medium" role="alert">
            {serverError}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          disabled={form.formState.isSubmitting}
          data-testid="login-submit"
        >
          {form.formState.isSubmitting ? t('common.loading') : t('auth.login.submit')}
        </Button>

        <div className="text-center text-sm">
          <Link
            to="/forgot-password"
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('auth.login.forgot_password')}
          </Link>
        </div>

        <div className="text-muted-foreground relative my-2 flex items-center gap-3 text-xs">
          <div className="bg-border h-px flex-1" />
          <span>{t('auth.or')}</span>
          <div className="bg-border h-px flex-1" />
        </div>

        <GoogleButton />
        <FacebookButton />
        <TelegramLoginWidget />
      </form>
    </AuthLayout>
  )
}
