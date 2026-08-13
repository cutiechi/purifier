export class AuthError extends Error {
  readonly error: string
  readonly statusCode: number

  constructor(error: string, statusCode: number) {
    super(error)
    this.name = "AuthError"
    this.error = error
    this.statusCode = statusCode
  }
}

export type AuthMe = {
  enabled: boolean
  sub: string | null
  email: string | null
  name: string | null
}

export type AuthConfig =
  | { enabled: false; buttonText: string; partial: boolean }
  | {
      enabled: true
      issuer: string
      clientId: string
      clientSecret: string
      redirectUri: string
      secret: string
      buttonText: string
      partial: false
    }

export const COOKIE_SESSION = "purifier_session"
export const COOKIE_OAUTH_STATE = "purifier_oauth_state"
export const COOKIE_OAUTH_VERIFIER = "purifier_oauth_code_verifier"
export const SESSION_MAX_AGE_S = 604_800
export const OAUTH_COOKIE_MAX_AGE_S = 600

export function emptyAuthMe(): AuthMe {
  return { enabled: false, sub: null, email: null, name: null }
}
