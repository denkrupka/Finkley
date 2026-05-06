import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'

const schema = z.object({
  email: z.string().min(1, 'auth.errors.email_required').email('auth.errors.email_invalid'),
})

type FormValues = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { resetPasswordForEmail } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const { error } = await resetPasswordForEmail(values.email)
    if (error) {
      setServerError(error.message)
      return
    }
    setSentTo(values.email)
  }

  if (sentTo) {
    return (
      <AuthLayout
        title={t('auth.forgot.sent_title')}
        subtitle={t('auth.forgot.sent_subtitle', { email: sentTo })}
      >
        <div className="text-center">
          <Link to="/login" className="text-secondary text-sm font-semibold hover:underline">
            {t('auth.signup.confirm_back_to_login')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('auth.forgot.back')}
        </Link>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
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

        {serverError ? (
          <p className="text-destructive text-sm font-medium" role="alert">
            {serverError}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.loading') : t('auth.forgot.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
