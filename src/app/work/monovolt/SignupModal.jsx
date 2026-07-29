'use client'

import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react'
import useMeasure from 'react-use-measure'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * CrowdVolt's sign-up modal — the step morph.
 *
 * Ported from:
 *   mono-volt/apps/web/app/components/core/sign-up/SignupModalWorkflow.tsx
 *     — the whole transition rig: SLIDE_TRANSITION / TITLE_TRANSITION, the
 *       useMeasure height animation, the direction-aware body slide, the
 *       title-leads-body choreography, the back-button clip-path reveal, the
 *       animated bolt in the step-0 title.
 *   mono-volt/apps/web/app/containers/core/sign-up/SignupModalContainer.tsx
 *     — the shell: the lighter blurred scrim (black/30 + blur(4px)) that
 *       SearchModalDesktop.tsx explicitly copies, the black/80 + backdrop-blur
 *       panel with its white hairline and inset top highlight, the ambient
 *       purple blobs and their pause-on-hidden-tab, and the 550ms max-width
 *       morph between step 0 and the later steps.
 *   mono-volt/apps/web/app/components/core/sign-up/PhoneAuth.tsx
 *   mono-volt/apps/web/app/components/core/sign-up/PhoneInputSplit.tsx
 *   mono-volt/apps/web/app/components/core/sign-up/PhoneVerify.tsx
 *   mono-volt/apps/web/app/components/core/sign-up/UserDetails.tsx
 *     — the three step bodies, their inputs and their button states.
 *   mono-volt/apps/web/app/components/core/ui/ButtonLoadingContent.tsx
 *   mono-volt/apps/web/app/components/core/ui/shake-on-disabled-click.tsx
 *   mono-volt/apps/web/app/globals.css
 *     — signup-step-child-enter + the per-step stagger delays, shakeDisabled,
 *       otp-caret, cvBlob1/cvBlob2.
 *   mono-volt/packages/copy/src/auth.ts (AUTH_COPY) — every string below.
 *
 * THE ONE THING THIS TILE IS ABOUT — the panel does not cut between steps, it
 * morphs. The step body lives in a container whose height is animated toward
 * the *measured* natural height of the current step's form (react-use-measure),
 * and the last non-zero measurement is held in a ref so AnimatePresence's
 * mode="wait" gap (old child gone, new child not yet mounted) can't collapse
 * the animation to zero. Result: H1 → H2 on one curve, never H1 → 0 → H2.
 * 300ms on cubic-bezier(0.22, 1, 0.36, 1) — fast out, gentle settle.
 *
 * What changed from the source, and why:
 *   - It is not a modal. There is no Dialog, no portal, no position: fixed —
 *     the tile is the viewport, the scrim is painted inside it, and the panel
 *     sits centred on top. Nothing here can cover the page it is on.
 *   - Five steps become three: phone → verify → details. The profile-picture
 *     step (a cropper, a file picker and popovers) and the Welcome step (a
 *     full-bleed marquee) both need more room than a grid tile has. Continue
 *     on the last step loops back to the first so the tile always has
 *     something to show.
 *   - No auth. "Continue" waits ~550ms with the button in its loading state
 *     and then advances; the only check is that the fields aren't empty.
 *   - The left decoration panel (SignupDecorationPanel, 38% of a 960px dialog)
 *     is gone — there is no room for it — but the width morph it drove is
 *     kept: the panel is wider on step 0 and narrows once you advance, on the
 *     source's 550ms cubic-bezier(0.22, 1, 0.36, 1).
 *   - The country chip loses its flag. react-international-phone's FlagImage
 *     isn't here and no flag asset ships in apps/web/public; the chip is still
 *     an editable calling code with the divider and as-you-type formatting.
 *   - First and last name sit on one row rather than stacked — three stacked
 *     fields plus the opt-in would push the panel past the tile's height.
 *   - The legal links and the resend link take var(--explore-accent) instead
 *     of Tailwind's blue-500. There is no blue in CrowdVolt's token file, and
 *     the reserved orange is what the rest of the product spends on links.
 *   - Nothing autofocuses. A tile in a grid has no business taking the caret.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── Transitions, verbatim from SignupModalWorkflow.tsx ──────────────────── */

// "snap" curve — fast out, gentle settle.
const SLIDE_TRANSITION = { type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }
// Title slightly faster than the slide, so the title fade finishes a hair
// before the body lands: title leads, body follows.
const TITLE_TRANSITION = { type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }
const SLIDE_DISTANCE = 20
const INSTANT = { duration: 0 }

// Title + subtitle are a pure opacity fade — no y, no scale. The title stays
// visually anchored while the body slides around it.
const TITLE_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

const MESSAGE_VARIANTS = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
}

// ButtonLoadingContent's "slide" preset.
const BUTTON_CONTENT_VARIANTS = {
  initial: { opacity: 0, y: '110%' },
  animate: { opacity: 1, y: '0%' },
  exit: { opacity: 0, y: '-110%' },
}

/* ── Copy, from packages/copy/src/auth.ts ────────────────────────────────── */

const COPY = {
  welcomeTitlePrefix: 'Welcome to',
  brand: 'CrowdVolt',
  subtitleLoginOrSignup: 'Log in or sign up',
  verifyTitle: 'Verify your number',
  detailsTitle: "Let's get to know you",
  detailsSubtitle: 'Tell us a little bit about yourself',
  backToAccountInfo: 'Account info',
  phoneNumberLabel: 'Phone number',
  countryCallingCodeLabel: 'Country calling code',
  submit: 'Submit',
  agreePrefix: 'By continuing, you agree to our',
  termsLabel: 'Terms',
  privacyLabel: 'Privacy Policy',
  consentSuffix:
    ', and consent to receive texts. Reply STOP to opt-out and HELP for help.',
  didntGetCode: "Didn't get a code?",
  resendLink: 'Resend code',
  verifyCta: 'Verify',
  firstNameLabel: 'First name',
  lastNameLabel: 'Last name',
  emailLabel: 'Email',
  firstNamePlaceholder: 'John',
  lastNamePlaceholder: 'Summit',
  emailPlaceholder: 'john.summit@gmail.com',
  optInPromos: 'Opt in to receive exclusive deals and event promotions',
  continue: 'Continue',
}

const codeSentSubtitle = (phone) => `Enter the code we sent to ${phone}`
const resendCodeIn = (s) => `Resend code in ${s}s`

const STEP_COUNT = 3
const CODE_LENGTH = 6
const RESEND_COOLDOWN = 15
const FAKE_SUBMIT_MS = 550

const EMPTY_DETAILS = { first: '', last: '', email: '', promos: true }

/* ── Phone formatting — the readable half of PhoneInputSplit ─────────────── */

/** NANP is capped at 10 national digits; everything else gets the E.164 ceiling. */
function maxNationalDigits(callingCode) {
  if (callingCode === '+1') return 10
  return Math.max(4, 15 - callingCode.replace(/\D/g, '').length)
}

/** As-you-type display formatting. Only +1 gets a shape; the rest stay bare. */
function formatNational(digits, callingCode) {
  if (callingCode !== '+1') return digits
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

/** CircularProgress, reduced to the one shape the buttons ever ask it for. */
function Spinner() {
  return <span className="mvsu-spinner" aria-hidden />
}

/**
 * ButtonLoadingContent — label and spinner swap on popLayout so the button's
 * own box never moves; the outgoing content leaves upward as the new content
 * arrives from below.
 */
function ButtonContent({ loading, children }) {
  return (
    <span className="mvsu-btn-content">
      <AnimatePresence initial={false} mode="popLayout">
        {!loading && (
          <motion.span
            key="idle"
            className="mvsu-btn-layer"
            variants={BUTTON_CONTENT_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {children}
          </motion.span>
        )}
        {loading && (
          <motion.span
            key="loading"
            className="mvsu-btn-layer"
            variants={BUTTON_CONTENT_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <Spinner />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/**
 * ShakeOnDisabledClick — while disabled the children get pointer-events: none
 * so the click lands on the wrapper, which replays the shake keyframe. The
 * source also fires a two-pulse error haptic; there is no haptics package
 * here, so the shake is the whole feedback.
 */
function ShakeOnDisabledClick({ disabled, className, children }) {
  const wrapperRef = useRef(null)

  const handleClick = (e) => {
    if (!disabled) return
    e.preventDefault()
    e.stopPropagation()
    const el = wrapperRef.current
    if (!el) return
    el.classList.remove('mvsu-shake')
    void el.offsetWidth // force reflow so consecutive clicks restart it
    el.classList.add('mvsu-shake')
  }

  return (
    <div ref={wrapperRef} onClick={handleClick} className={className}>
      <div className={disabled ? 'mvsu-inert' : undefined}>{children}</div>
    </div>
  )
}

/** The bolt out of the step-0 title. Collapsed until the brand is hovered. */
function BoltMark() {
  return (
    <span className="mvsu-bolt-wrap" aria-hidden>
      <svg className="mvsu-bolt" viewBox="0 0 18 26" fill="none">
        <path
          d="M13.9656 0C13.7248 0 13.5022 0.124958 13.3874 0.327176C12.7317 1.48069 11.3232 2.36547 10.0625 2.36547C8.93072 2.36547 8.26799 1.65267 8.35743 0.673163C8.39053 0.31038 8.08276 0.000671819 7.70033 0.000671819H7.07352C6.80237 0.000671819 6.5594 0.158549 6.46009 0.39906L0.0461935 15.9631C-0.123539 16.3749 0.195501 16.8203 0.659623 16.8203H1.17798C1.41884 16.8203 1.64139 16.6954 1.75619 16.4932C2.41188 15.3396 3.82044 14.4549 5.08111 14.4549C6.21289 14.4549 6.87562 15.1677 6.78618 16.1472C6.75307 16.51 7.06085 16.8197 7.44327 16.8197H8.07008C8.34123 16.8197 8.58421 16.6618 8.68351 16.4213L15.0974 0.857241C15.2671 0.445416 14.9481 0 14.484 0H13.9656Z"
          fill="hsl(var(--mv-primary))"
        />
        <path
          d="M5.09143 25.1376L10.6053 11.7583C10.7046 11.5178 10.9475 11.3599 11.2187 11.3599H16.9375C17.4903 11.3599 17.7974 11.9693 17.4523 12.3804L6.22039 25.7597C5.74852 26.322 4.81605 25.8081 5.09213 25.1376H5.09143Z"
          fill="hsl(var(--mv-primary))"
        />
        <path
          d="M8.55637 16.7916L10.7692 11.3599H16.9578C17.6184 11.3599 17.855 12.1923 17.2845 12.5101L8.55566 16.7916H8.55637Z"
          fill="color-mix(in srgb, hsl(var(--mv-primary)) 68%, #000)"
        />
      </svg>
    </span>
  )
}

/* ── The tile ────────────────────────────────────────────────────────────── */

function SignupModalDemo() {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [loading, setLoading] = useState(false)

  const [callingCode, setCallingCode] = useState('+1')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [otpFocused, setOtpFocused] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [details, setDetails] = useState(EMPTY_DETAILS)

  const reduceMotion = useReducedMotion()
  const slideTransition = reduceMotion ? INSTANT : SLIDE_TRANSITION
  const titleTransition = reduceMotion ? INSTANT : TITLE_TRANSITION
  const slideDistance = reduceMotion ? 0 : SLIDE_DISTANCE

  /* ── The height morph ──────────────────────────────────────────────────
   * Measure the current step's natural height and animate the form container
   * toward it. The last non-zero measurement is held so the mode="wait" gap
   * (old child unmounted, new one not yet mounted) can't collapse the
   * animated height to 0 — H1 → H2 on one curve, not H1 → 0 → H2. Padding
   * lives on the measured inner div so the natural height includes it and the
   * animated outer never clips. */
  const [formContentRef, formBounds] = useMeasure()
  const lastFormHeightRef = useRef(0)
  if (formBounds.height > 0) lastFormHeightRef.current = formBounds.height
  const targetFormHeight = lastFormHeightRef.current || 'auto'

  /* ── Timers. Every one of them is torn down on unmount. ────────────────── */
  const submitTimerRef = useRef(null)
  useEffect(
    () => () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current)
      submitTimerRef.current = null
    },
    [],
  )

  // Resend cooldown. Keyed on "is it running" rather than on the value, so the
  // interval isn't rebuilt every tick.
  const cooling = cooldown > 0
  useEffect(() => {
    if (!cooling) return undefined
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooling])

  // The ambient blobs keep ticking in a background tab; freeze them explicitly.
  const [tabHidden, setTabHidden] = useState(false)
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden)
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /* ── The step machine ──────────────────────────────────────────────────── */

  const phoneDigits = phone.replace(/\D/g, '')
  const canContinue =
    step === 0
      ? phoneDigits.length > 0
      : step === 1
        ? code.length === CODE_LENGTH
        : Boolean(details.first.trim() && details.last.trim() && details.email.trim())

  const handleSubmit = useCallback(
    (e) => {
      if (e) e.preventDefault()
      if (!canContinue || loading) return
      setLoading(true)
      submitTimerRef.current = setTimeout(() => {
        submitTimerRef.current = null
        setLoading(false)
        setDirection(1)
        if (step >= STEP_COUNT - 1) {
          // Loop — the tile always has something to show.
          setPhone('')
          setCode('')
          setCooldown(0)
          setDetails(EMPTY_DETAILS)
          setStep(0)
        } else {
          setStep(step + 1)
        }
      }, FAKE_SUBMIT_MS)
    },
    [canContinue, loading, step],
  )

  const handleBack = useCallback(() => {
    if (step === 0) return
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current)
      submitTimerRef.current = null
    }
    setLoading(false)
    setDirection(-1)
    setStep(step - 1)
  }, [step])

  /* ── Field handlers ────────────────────────────────────────────────────── */

  const handleCallingCodeChange = (e) => {
    let next = e.target.value.replace(/[^\d+]/g, '')
    next = next.includes('+')
      ? `+${next.replace(/\+/g, '')}`
      : next.length > 0
        ? `+${next}`
        : '+'
    setCallingCode(next.slice(0, 5))
  }

  const handlePhoneChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, maxNationalDigits(callingCode))
    setPhone(formatNational(digits, callingCode))
  }

  const handleCodeChange = (e) => {
    setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
  }

  const handleDetailChange = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setDetails((d) => ({ ...d, [key]: value }))
  }

  const handleResend = (e) => {
    e.preventDefault()
    if (cooling) return
    setCode('')
    setCooldown(RESEND_COOLDOWN)
  }

  /* ── Step chrome ───────────────────────────────────────────────────────── */

  const stepTitle =
    step === 0 ? (
      <span className="mvsu-title-row">
        {COPY.welcomeTitlePrefix}{' '}
        <span className="mvsu-brand">
          <BoltMark />
          {COPY.brand}
        </span>
      </span>
    ) : step === 1 ? (
      COPY.verifyTitle
    ) : (
      COPY.detailsTitle
    )

  const stepSubtitle =
    step === 0
      ? COPY.subtitleLoginOrSignup
      : step === 1
        ? codeSentSubtitle(`${callingCode} ${phone}`.trim())
        : COPY.detailsSubtitle

  const selectedIndex = Math.min(code.length, CODE_LENGTH - 1)

  /* ── Step bodies ───────────────────────────────────────────────────────── */

  const renderStep = () => {
    if (step === 0) {
      return (
        <form className="mvsu-form" onSubmit={handleSubmit}>
          {/* PhoneInputSplit — one bordered container holding the editable
              calling-code chip, a hairline divider, and the number field. */}
          <div
            className="mvsu-field mvsu-phone"
            role="group"
            aria-label={COPY.phoneNumberLabel}
          >
            <div className="mvsu-chip">
              <input
                className="mvsu-chip-input"
                aria-label={COPY.countryCallingCodeLabel}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={5}
                value={callingCode}
                onChange={handleCallingCodeChange}
                style={{ width: `${Math.max(2.5, callingCode.length + 0.5)}ch` }}
              />
            </div>
            <span className="mvsu-divider" aria-hidden />
            <input
              className="mvsu-phone-input"
              aria-label={COPY.phoneNumberLabel}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={COPY.phoneNumberLabel}
              value={phone}
              onChange={handlePhoneChange}
            />
          </div>

          <p className="mvsu-terms">
            {COPY.agreePrefix}{' '}
            <span className="mvsu-link">{COPY.termsLabel}</span>,{' '}
            <span className="mvsu-link">{COPY.privacyLabel}</span>
            {COPY.consentSuffix}
          </p>

          <ShakeOnDisabledClick disabled={!canContinue || loading} className="mvsu-cta">
            <button type="submit" className="mvsu-button" disabled={!canContinue || loading}>
              <ButtonContent loading={loading}>{COPY.submit}</ButtonContent>
            </button>
          </ShakeOnDisabledClick>
        </form>
      )
    }

    if (step === 1) {
      return (
        <form className="mvsu-form" onSubmit={handleSubmit}>
          <div className="mvsu-otp">
            {Array.from({ length: CODE_LENGTH }).map((_, i) => {
              const char = code[i]
              const selected = otpFocused && i === selectedIndex && code.length < CODE_LENGTH
              return (
                <span
                  key={i}
                  className={`mvsu-otp-cell${char ? ' is-filled' : ''}${selected ? ' is-selected' : ''}`}
                >
                  {char ?? ''}
                </span>
              )
            })}
            <input
              className="mvsu-otp-input"
              aria-label="Verification code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={handleCodeChange}
              onFocus={() => setOtpFocused(true)}
              onBlur={() => setOtpFocused(false)}
            />
          </div>

          <div className="mvsu-resend">
            <AnimatePresence mode="popLayout" initial={false}>
              {cooling ? (
                <motion.p
                  key="cooldown"
                  variants={MESSAGE_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={titleTransition}
                >
                  {resendCodeIn(cooldown)}
                </motion.p>
              ) : (
                <motion.p
                  key="resend"
                  variants={MESSAGE_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={titleTransition}
                >
                  {COPY.didntGetCode}{' '}
                  <button type="button" className="mvsu-resend-btn" onClick={handleResend}>
                    {COPY.resendLink}
                  </button>
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <ShakeOnDisabledClick disabled={!canContinue || loading} className="mvsu-cta">
            <button type="submit" className="mvsu-button" disabled={!canContinue || loading}>
              <ButtonContent loading={loading}>{COPY.verifyCta}</ButtonContent>
            </button>
          </ShakeOnDisabledClick>
        </form>
      )
    }

    return (
      <form className="mvsu-form" onSubmit={handleSubmit}>
        <div className="mvsu-row">
          <label className="mvsu-labelled">
            <span className="mvsu-label">{COPY.firstNameLabel}</span>
            <input
              className="mvsu-field mvsu-input"
              autoComplete="off"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              value={details.first}
              onChange={handleDetailChange('first')}
              placeholder={COPY.firstNamePlaceholder}
            />
          </label>
          <label className="mvsu-labelled">
            <span className="mvsu-label">{COPY.lastNameLabel}</span>
            <input
              className="mvsu-field mvsu-input"
              autoComplete="off"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              value={details.last}
              onChange={handleDetailChange('last')}
              placeholder={COPY.lastNamePlaceholder}
            />
          </label>
        </div>

        <label className="mvsu-labelled">
          <span className="mvsu-label">{COPY.emailLabel}</span>
          <input
            className="mvsu-field mvsu-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={details.email}
            onChange={handleDetailChange('email')}
            placeholder={COPY.emailPlaceholder}
          />
        </label>

        <label className="mvsu-check">
          <input
            type="checkbox"
            checked={details.promos}
            onChange={handleDetailChange('promos')}
          />
          <span>{COPY.optInPromos}</span>
        </label>

        <ShakeOnDisabledClick disabled={!canContinue || loading} className="mvsu-cta">
          <button type="submit" className="mvsu-button" disabled={!canContinue || loading}>
            <ButtonContent loading={loading}>{COPY.continue}</ButtonContent>
          </button>
        </ShakeOnDisabledClick>
      </form>
    )
  }

  /* ── Shell ─────────────────────────────────────────────────────────────── */

  return (
    <section className="mv-scope mvsu-root" aria-label="CrowdVolt sign-up">
      {/* The scrim the search modal copies: black/30 with a 4px backdrop blur. */}
      <div className="mvsu-scrim" aria-hidden />

      <div className="mvsu-center">
        <div
          className="mvsu-panel"
          /* SignupModalContainer widens the dialog to 960px on step 0 for the
             decoration panel and snaps back to 520 once you advance, on a
             550ms snap curve. The panel is gone; the morph isn't. */
          style={{ maxWidth: step === 0 ? 420 : 358 }}
        >
          {/* Ambient blobs behind everything. */}
          <div className="mvsu-blobs" aria-hidden>
            <span
              className="mvsu-blob mvsu-blob-1"
              style={{ animationPlayState: tabHidden ? 'paused' : 'running' }}
            />
            <span
              className="mvsu-blob mvsu-blob-2"
              style={{ animationPlayState: tabHidden ? 'paused' : 'running' }}
            />
          </div>

          {/* Back — the arrow pops, then the label wipes in behind it. */}
          <div className="mvsu-back-slot">
            <button
              type="button"
              onClick={handleBack}
              className={`mvsu-back${step > 0 ? ' is-visible' : ''}`}
              tabIndex={step > 0 ? 0 : -1}
              aria-hidden={step === 0}
            >
              <svg
                className="mvsu-back-arrow"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="mvsu-back-text">
                {step === 1 ? COPY.phoneNumberLabel : COPY.backToAccountInfo}
              </span>
            </button>
          </div>

          <MotionConfig transition={slideTransition}>
            <div className="mvsu-col">
              <MotionConfig transition={titleTransition}>
                <div className="mvsu-head">
                  <AnimatePresence initial={false} mode="wait">
                    <motion.h3
                      key={`title${step}`}
                      className="mvsu-heading"
                      variants={TITLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {stepTitle}
                    </motion.h3>
                  </AnimatePresence>
                  <AnimatePresence initial={false} mode="wait">
                    <motion.p
                      key={`sub${step}`}
                      className="mvsu-subheading"
                      variants={TITLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {stepSubtitle}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </MotionConfig>

              {/* The morph. Outer animates to the measured height; the inner
                  div carries the padding so the measurement includes it. */}
              <motion.div
                className="mvsu-formwrap"
                animate={{ height: targetFormHeight }}
                transition={slideTransition}
              >
                <div ref={formContentRef} className="mvsu-formpad">
                  <AnimatePresence initial={false} custom={direction} mode="wait">
                    <motion.div
                      key={`slide${step}`}
                      custom={direction}
                      className="mvsu-stagger"
                      variants={{
                        initial: (d) => ({ y: d * -slideDistance, opacity: 0 }),
                        // Body enters AFTER the title — the title is the
                        // anchor, the body lands a beat later.
                        animate: () => ({
                          y: 0,
                          opacity: 1,
                          transition: { ...slideTransition, delay: reduceMotion ? 0 : 0.1 },
                        }),
                        exit: (d) => ({ y: d * -slideDistance, opacity: 0 }),
                      }}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {renderStep()}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </MotionConfig>
        </div>
      </div>

      {/* Global-scoped on purpose: styled-jsx only tags JSX authored inside the
          component that owns the <style jsx> block, and the pieces above
          (ButtonContent, ShakeOnDisabledClick, BoltMark) are their own
          components. Every selector is nested under .mvsu-root, which exists
          nowhere else, so nothing escapes this tile. */}
      <style jsx global>{`
        .mvsu-root {
          position: relative;
          overflow: hidden;
          width: 100%;
          min-height: 400px;
          display: flex;
          font-family: var(--mv-font);
          /* The ground the scrim sits on: the page value, one step up from the
             panel, so the scrim has something to darken. */
          background: var(--explore-surface);
        }

        .mvsu-root *,
        .mvsu-root *::before,
        .mvsu-root *::after {
          box-sizing: border-box;
        }

        /* ── Scrim ─────────────────────────────────────────────────────────
         * SignupModalContainer overrides Radix's bg-black/80 overlay down to
         * this, and SearchModalDesktop copies it by name. */
        .mvsu-root .mvsu-scrim {
          position: absolute;
          inset: 0;
          background-color: rgb(0 0 0 / 0.3);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }

        .mvsu-root .mvsu-center {
          position: relative;
          z-index: 1;
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 14px;
        }

        /* ── Panel ─────────────────────────────────────────────────────────── */
        .mvsu-root .mvsu-panel {
          position: relative;
          width: 100%;
          border-radius: calc(var(--explore-radius) * 2);
          background: rgb(0 0 0 / 0.8);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgb(255 255 255 / 0.08);
          box-shadow: inset 0 4px 8px rgb(255 255 255 / 0.06);
          overflow: hidden;
          padding-bottom: 16px;
          transition: max-width 550ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        /* ── Ambient blobs ─────────────────────────────────────────────────── */
        .mvsu-root .mvsu-blobs {
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .mvsu-root .mvsu-blob {
          position: absolute;
          display: block;
          border-radius: 9999px;
        }
        .mvsu-root .mvsu-blob-1 {
          width: 280px;
          height: 280px;
          top: -14%;
          left: -8%;
          opacity: 0.14;
          background: radial-gradient(circle, hsl(var(--mv-primary) / 0.6) 0%, transparent 70%);
          animation: mvsu-blob-1 20s ease-in-out infinite;
        }
        .mvsu-root .mvsu-blob-2 {
          width: 240px;
          height: 240px;
          bottom: -8%;
          left: 18%;
          opacity: 0.1;
          background: radial-gradient(circle, hsl(var(--mv-primary) / 0.5) 0%, transparent 70%);
          animation: mvsu-blob-2 25s ease-in-out infinite;
        }
        @keyframes mvsu-blob-1 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -20px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 15px) scale(0.95);
          }
        }
        @keyframes mvsu-blob-2 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(-25px, 20px) scale(0.9);
          }
          66% {
            transform: translate(15px, -25px) scale(1.05);
          }
        }

        /* ── Back ──────────────────────────────────────────────────────────── */
        .mvsu-root .mvsu-back-slot {
          position: absolute;
          left: 10px;
          top: 10px;
          z-index: 2;
          overflow: hidden;
        }
        .mvsu-root .mvsu-back {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 2px;
          border: 0;
          background: none;
          cursor: pointer;
          font: inherit;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--explore-text-muted);
          transition: color 150ms ease;
          opacity: 0;
          pointer-events: none;
        }
        .mvsu-root .mvsu-back.is-visible {
          opacity: 1;
          pointer-events: auto;
        }
        @media (hover: hover) {
          .mvsu-root .mvsu-back:hover {
            color: var(--explore-text);
          }
        }
        .mvsu-root .mvsu-back-arrow,
        .mvsu-root .mvsu-back-text {
          opacity: 0;
          will-change: opacity, transform;
          backface-visibility: hidden;
        }
        .mvsu-root .mvsu-back-arrow {
          flex-shrink: 0;
          transform-box: fill-box;
          transform-origin: center;
        }
        .mvsu-root .mvsu-back-text {
          white-space: nowrap;
        }
        .mvsu-root .mvsu-back.is-visible .mvsu-back-arrow {
          animation: mvsu-back-arrow-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
        }
        .mvsu-root .mvsu-back.is-visible .mvsu-back-text {
          animation: mvsu-back-text-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) 0.2s forwards;
        }
        @keyframes mvsu-back-arrow-in {
          0% {
            opacity: 0.01;
            transform: scale(0.5) translateZ(0);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateZ(0);
          }
        }
        @keyframes mvsu-back-text-in {
          0% {
            opacity: 0.01;
            transform: translate3d(-15px, 0, 0);
            clip-path: inset(0 100% 0 0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
            clip-path: inset(0 0% 0 0);
          }
        }

        /* ── Column + title ────────────────────────────────────────────────── */
        .mvsu-root .mvsu-col {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
        }
        /* Fixed height on purpose. The source's dialog is a fixed 82vh box, so
           a two-line subtitle never moves anything; here the panel is auto
           height, so the head reserves room for a title plus two subtitle
           lines. Without it, a wrapping subtitle would snap the panel outside
           the measured morph, which is the one thing this tile is about.
           Same reason the column carries no layout prop: the form container
           already animates its own height, and a layout animation on top of
           that double-eases the same pixels. */
        .mvsu-root .mvsu-head {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          min-height: 92px;
          padding: 28px 16px 0;
        }
        .mvsu-root .mvsu-heading {
          margin: 0;
          font-size: 19px;
          line-height: 1.2;
          font-weight: 500;
          letter-spacing: -0.02em;
          color: var(--explore-text);
          text-align: center;
        }
        .mvsu-root .mvsu-subheading {
          margin: 6px 0 0;
          font-size: 13px;
          line-height: 1.35;
          color: var(--explore-text-muted);
          text-align: center;
          text-wrap: pretty;
        }
        .mvsu-root .mvsu-title-row,
        .mvsu-root .mvsu-brand {
          display: inline-flex;
          align-items: center;
        }

        /* The bolt: collapsed to a sliver, opens when the brand is hovered. */
        .mvsu-root .mvsu-bolt-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          will-change: width, opacity, transform;
          width: 0.3em;
          opacity: 0;
          transform: scale(0.5) translateY(-0.04em);
          transition:
            width 0.35s cubic-bezier(0.22, 1, 0.36, 1),
            opacity 0.2s ease-out,
            transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .mvsu-root .mvsu-bolt {
          height: 1.1em;
          width: auto;
          flex-shrink: 0;
          transform-box: fill-box;
          transform-origin: center;
          opacity: 0;
          transform: scale(0.4) rotate(-15deg);
          transition:
            opacity 0.2s ease-out,
            transform 0.25s ease-out;
        }
        @media (hover: hover) {
          .mvsu-root .mvsu-brand:hover .mvsu-bolt-wrap {
            width: 1.5em;
            opacity: 1;
            transform: scale(1) translateY(-0.04em);
            transition:
              width 0.4s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .mvsu-root .mvsu-brand:hover .mvsu-bolt {
            opacity: 1;
            transform: scale(1) rotate(0deg);
            transition:
              opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
            animation: mvsu-bolt-idle 3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.6s infinite;
          }
        }
        /* No hover to give it — show it. */
        @media (hover: none) {
          .mvsu-root .mvsu-bolt-wrap {
            width: 1.5em;
            opacity: 1;
            transform: scale(1) translateY(-0.04em);
          }
          .mvsu-root .mvsu-bolt {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes mvsu-bolt-idle {
          0%,
          80%,
          100% {
            transform: scale(1) rotate(0deg);
          }
          85% {
            transform: scale(1.12) rotate(-8deg);
          }
          90% {
            transform: scale(0.97) rotate(4deg);
          }
          95% {
            transform: scale(1.04) rotate(-1deg);
          }
        }

        /* ── The morphing form container ───────────────────────────────────── */
        .mvsu-root .mvsu-formwrap {
          overflow: hidden;
        }
        .mvsu-root .mvsu-formpad {
          padding: 20px 18px 4px;
        }
        .mvsu-root .mvsu-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
          width: 100%;
        }

        /* Stagger — every direct child of a step's form enters on its own
           beat, all starting at 0.10s to match the body's own delay. */
        .mvsu-root .mvsu-stagger .mvsu-form > * {
          animation: mvsu-child-enter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity;
        }
        .mvsu-root .mvsu-stagger .mvsu-form > *:nth-child(1) {
          animation-delay: 0.1s;
        }
        .mvsu-root .mvsu-stagger .mvsu-form > *:nth-child(2) {
          animation-delay: 0.16s;
        }
        .mvsu-root .mvsu-stagger .mvsu-form > *:nth-child(3) {
          animation-delay: 0.22s;
        }
        .mvsu-root .mvsu-stagger .mvsu-form > *:nth-child(4) {
          animation-delay: 0.28s;
        }
        .mvsu-root .mvsu-stagger .mvsu-form > *:nth-child(5) {
          animation-delay: 0.34s;
        }
        @keyframes mvsu-child-enter {
          from {
            opacity: 0;
            transform: translate3d(0, -10px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        /* ── Fields ────────────────────────────────────────────────────────── */
        .mvsu-root .mvsu-field {
          border: 1px solid rgb(255 255 255 / 0.3);
          border-radius: var(--explore-radius);
          background: transparent;
          transition: border-color 150ms ease;
        }
        .mvsu-root .mvsu-field:focus-within {
          border-color: rgb(255 255 255 / 0.7);
        }
        .mvsu-root .mvsu-phone {
          display: flex;
          align-items: stretch;
          height: 40px;
          width: 100%;
        }
        .mvsu-root .mvsu-chip {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          padding: 0 9px 0 11px;
        }
        .mvsu-root .mvsu-chip-input,
        .mvsu-root .mvsu-phone-input,
        .mvsu-root .mvsu-input {
          background: transparent;
          border: 0;
          outline: none;
          color: var(--explore-text);
          font: inherit;
          font-size: 14px;
          font-weight: 500;
        }
        .mvsu-root .mvsu-divider {
          flex-shrink: 0;
          align-self: stretch;
          width: 1px;
          margin: 8px 0;
          border-radius: 9999px;
          background: var(--explore-hairline);
        }
        .mvsu-root .mvsu-phone-input {
          flex: 1;
          min-width: 0;
          padding: 0 11px;
        }
        .mvsu-root .mvsu-phone-input::placeholder,
        .mvsu-root .mvsu-input::placeholder {
          color: rgb(255 255 255 / 0.4);
        }

        .mvsu-root .mvsu-row {
          display: flex;
          gap: 10px;
        }
        .mvsu-root .mvsu-labelled {
          display: block;
          flex: 1;
          min-width: 0;
        }
        .mvsu-root .mvsu-label {
          display: block;
          font-size: 12.5px;
          line-height: 1.4;
          color: var(--explore-text);
          padding-bottom: 3px;
        }
        .mvsu-root .mvsu-input {
          display: block;
          width: 100%;
          height: 36px;
          padding: 0 10px;
        }

        /* ── Terms + links ─────────────────────────────────────────────────── */
        .mvsu-root .mvsu-terms {
          margin: 0;
          font-size: 11px;
          line-height: 1.45;
          text-align: center;
          text-wrap: pretty;
          color: var(--explore-text-faint);
        }
        .mvsu-root .mvsu-link {
          font-weight: 600;
          color: var(--explore-accent);
        }

        /* ── OTP ───────────────────────────────────────────────────────────── */
        .mvsu-root .mvsu-otp {
          position: relative;
          display: flex;
          gap: 6px;
          width: 100%;
        }
        .mvsu-root .mvsu-otp-cell {
          position: relative;
          flex: 1;
          min-width: 0;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--explore-radius);
          background: rgb(0 0 0 / 0.3);
          outline: 1px solid rgb(255 255 255 / 0.22);
          outline-offset: -1px;
          overflow: clip;
          font-size: 16px;
          font-weight: 500;
          color: transparent;
          transition:
            outline-color 150ms ease,
            color 150ms ease;
        }
        .mvsu-root .mvsu-otp-cell.is-filled {
          color: var(--explore-text);
        }
        .mvsu-root .mvsu-otp-cell.is-selected {
          outline-color: var(--explore-text);
        }
        .mvsu-root .mvsu-otp-cell.is-selected::before {
          content: '';
          position: absolute;
          left: 50%;
          top: 28%;
          bottom: 28%;
          width: 2px;
          transform: translateX(-50%);
          border-radius: 9999px;
          background: var(--explore-text);
          animation: mvsu-otp-caret 1s steps(2) infinite;
        }
        @keyframes mvsu-otp-caret {
          50% {
            opacity: 0;
          }
        }
        /* The real input sits over the cells: click anywhere, type anywhere. */
        .mvsu-root .mvsu-otp-input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          border: 0;
          background: transparent;
          font: inherit;
          color: transparent;
          caret-color: transparent;
          cursor: text;
        }

        .mvsu-root .mvsu-resend {
          font-size: 12.5px;
          line-height: 1.4;
          text-align: center;
          color: var(--explore-text-muted);
        }
        .mvsu-root .mvsu-resend p {
          margin: 0;
        }
        .mvsu-root .mvsu-resend-btn {
          display: inline;
          padding: 0;
          border: 0;
          background: none;
          cursor: pointer;
          font: inherit;
          font-weight: 600;
          color: var(--explore-accent);
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        /* ── Opt-in ────────────────────────────────────────────────────────── */
        .mvsu-root .mvsu-check {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          cursor: pointer;
          font-size: 11.5px;
          line-height: 1.4;
          text-wrap: pretty;
          color: var(--explore-text-muted);
        }
        .mvsu-root .mvsu-check input {
          appearance: none;
          -webkit-appearance: none;
          flex-shrink: 0;
          width: 15px;
          height: 15px;
          margin: 0;
          border: 1px solid var(--explore-hairline-strong);
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          position: relative;
          transition:
            background-color 150ms ease,
            border-color 150ms ease;
        }
        .mvsu-root .mvsu-check input:checked {
          background: var(--explore-text);
          border-color: var(--explore-text);
        }
        .mvsu-root .mvsu-check input:checked::after {
          content: '';
          position: absolute;
          left: 4.5px;
          top: 1.5px;
          width: 4px;
          height: 8px;
          border: solid #000;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }

        /* ── Button ────────────────────────────────────────────────────────── */
        .mvsu-root .mvsu-cta {
          margin-top: 2px;
        }
        .mvsu-root .mvsu-inert {
          pointer-events: none;
        }
        .mvsu-root .mvsu-button {
          position: relative;
          display: block;
          width: 100%;
          height: 38px;
          border: 0;
          border-radius: 9999px;
          background: var(--explore-text);
          color: #000;
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          overflow: hidden;
          transition:
            background-color 150ms ease,
            opacity 150ms ease;
        }
        @media (hover: hover) {
          .mvsu-root .mvsu-button:hover:not(:disabled) {
            background: rgb(255 255 255 / 0.9);
          }
        }
        .mvsu-root .mvsu-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .mvsu-root .mvsu-btn-content {
          position: relative;
          display: grid;
          place-items: center;
          height: 100%;
        }
        .mvsu-root .mvsu-btn-layer {
          grid-area: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .mvsu-root .mvsu-spinner {
          display: block;
          width: 17px;
          height: 17px;
          border: 2px solid rgb(0 0 0 / 0.12);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: mvsu-spin 0.8s linear infinite;
        }
        @keyframes mvsu-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* Shake — replayed by class, timed to the source's 380ms curve. */
        .mvsu-root .mvsu-shake {
          animation: mvsu-shake 380ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes mvsu-shake {
          0% {
            transform: translate3d(0, 0, 0);
          }
          12% {
            transform: translate3d(-9px, 0, 0);
          }
          28% {
            transform: translate3d(8px, 0, 0);
          }
          44% {
            transform: translate3d(-5px, 0, 0);
          }
          60% {
            transform: translate3d(3px, 0, 0);
          }
          76% {
            transform: translate3d(-1.5px, 0, 0);
          }
          92% {
            transform: translate3d(0.5px, 0, 0);
          }
          100% {
            transform: translate3d(0, 0, 0);
          }
        }

        /* ── Reduced motion ────────────────────────────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          .mvsu-root .mvsu-panel {
            transition: none;
          }
          .mvsu-root .mvsu-blob,
          .mvsu-root .mvsu-stagger .mvsu-form > *,
          .mvsu-root .mvsu-back.is-visible .mvsu-back-arrow,
          .mvsu-root .mvsu-back.is-visible .mvsu-back-text,
          .mvsu-root .mvsu-otp-cell.is-selected::before,
          .mvsu-root .mvsu-shake {
            animation: none !important;
          }
          .mvsu-root .mvsu-back-arrow,
          .mvsu-root .mvsu-back-text {
            opacity: 1;
            transform: none;
            clip-path: none;
          }
          .mvsu-root .mvsu-bolt-wrap,
          .mvsu-root .mvsu-bolt {
            transition: none;
          }
        }
        @media (prefers-reduced-motion: reduce) and (hover: hover) {
          .mvsu-root .mvsu-brand:hover .mvsu-bolt {
            animation: none;
          }
        }
      `}</style>
    </section>
  )
}

export default memo(SignupModalDemo)
