import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'
import { FacebookButton } from './FacebookButton'
import { GoogleButton } from './GoogleButton'

const schema = z
  .object({
    email: z.string().min(1, 'auth.errors.email_required').email('auth.errors.email_invalid'),
    password: z.string().min(8, 'auth.errors.password_too_short'),
    passwordConfirm: z.string().min(1, 'auth.errors.password_confirm_required'),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.errors.passwords_do_not_match',
  })

type FormValues = z.infer<typeof schema>

export function SignupPage() {
  const { t } = useTranslation()
  const { signUpWithPassword } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', passwordConfirm: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const { error, needsEmailConfirmation } = await signUpWithPassword(
      values.email,
      values.password,
    )
    if (error) {
      setServerError(error.message)
      return
    }
    if (needsEmailConfirmation) {
      setConfirmationSent(values.email)
      return
    }
    // Email confirmation выключен — сразу залогинены, идём в онбординг
    navigate('/onboarding', { replace: true })
  }

  if (confirmationSent) {
    return (
      <AuthLayout
        title={t('auth.signup.confirm_title')}
        subtitle={t('auth.signup.confirm_subtitle', { email: confirmationSent })}
      >
        <div className="flex flex-col gap-4 text-center">
          <p className="text-muted-foreground text-sm">{t('auth.signup.confirm_hint')}</p>
          <Link to="/login" className="text-secondary text-sm font-semibold hover:underline">
            {t('auth.signup.confirm_back_to_login')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      footer={
        <>
          {t('auth.signup.have_account')}{' '}
          <Link
            to="/login"
            className="text-secondary font-semibold hover:underline"
            data-testid="login-link"
          >
            {t('auth.signup.login_link')}
          </Link>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        data-testid="signup-form"
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
          hint={t('auth.signup.password_hint')}
          error={
            form.formState.errors.password?.message
              ? t(form.formState.errors.password.message)
              : null
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register('password')}
          />
        </Field>

        <Field
          id="passwordConfirm"
          label={t('auth.signup.password_confirm_label')}
          error={
            form.formState.errors.passwordConfirm?.message
              ? t(form.formState.errors.passwordConfirm.message)
              : null
          }
        >
          <Input
            id="passwordConfirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!form.formState.errors.passwordConfirm}
            {...form.register('passwordConfirm')}
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
          data-testid="signup-submit"
        >
          {form.formState.isSubmitting ? t('common.loading') : t('auth.signup.submit')}
        </Button>

        <div className="text-muted-foreground relative my-2 flex items-center gap-3 text-xs">
          <div className="bg-border h-px flex-1" />
          <span>{t('auth.or')}</span>
          <div className="bg-border h-px flex-1" />
        </div>

        <GoogleButton />
        <FacebookButton />
      </form>
    </AuthLayout>
  )
}
