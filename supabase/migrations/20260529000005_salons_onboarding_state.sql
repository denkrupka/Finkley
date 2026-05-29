-- ADR-030 — resume онбординга. Сохраняем state и текущий шаг чтобы при
-- внешнем редиректе (Instagram/Facebook OAuth, Stripe checkout) или
-- закрытии вкладки юзер вернулся ровно туда, где остановился.

alter table public.salons
  add column if not exists onboarding_state jsonb,
  add column if not exists onboarding_step_id text;

comment on column public.salons.onboarding_state is
  'Snapshot OnboardingState (см. OnboardingPage.tsx). Сохраняется после '
  'каждого перехода между шагами. Используется для resume онбординга '
  'если юзер ушёл с страницы до финального submit().';

comment on column public.salons.onboarding_step_id is
  'ID последнего активного шага (StepId из STEPS_FULL/QUICK). '
  'RootRedirect и onboarding entry проверяют этот столбец чтобы '
  'продолжить с правильного места.';
