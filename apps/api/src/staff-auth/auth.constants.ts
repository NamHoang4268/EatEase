export const STAFF_SESSION_COOKIE = 'eatease_staff_session';
export const STAFF_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1_000;

export const REQUIRED_PERMISSIONS = Symbol('required-permissions');
export const LOCATION_PARAMETER = Symbol('location-parameter');
