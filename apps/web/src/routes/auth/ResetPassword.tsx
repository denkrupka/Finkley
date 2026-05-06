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

const schema = z
  .object({
    password: z.string().min(8, 'auth.errors.password_too_short'),
    passwordConfirm: z.string().min(1, 'auth.errors.password_confirm_required'),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.errors.passwords_do_not_match',
  })

type FormValues = z.infer<typeof schema>

/**
 * Открывается по ссылке из email Supabase «recovery».
 * Supabase сам устанавливает временную сессию из URL fragment
 * (`detectSessionInUrl: true` в client.ts), поэтому updateUser работает.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { user, updatePassword, loading } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', passwordConfirm: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const { error } = await updatePassword(values.password)
    if (error) {
      setServerError(error.message)
      return
    }
    navigate('/login', { replace: true })
  }

  if (loading) {
    return (
      <AuthLayout title={t('common.loading')}>
        <div className="bg-muted h-10 animate-pulse rounded-md" />
      </AuthLayout>
    )
  }

  if (!user) {
    return (
      <AuthLayout title={t('auth.reset.invalid_title')} subtitle={t('auth.reset.invalid_subtitle')}>
        <div className="text-center">
          <Link
            to="/forgot-password"
            className="text-secondary text-sm font-semibold hover:underline"
          >
            {t('auth.reset.request_new')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')}>
      <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Field
          id="password"
          label={t('auth.reset.new_password_label')}
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

        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.loading') : t('auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
