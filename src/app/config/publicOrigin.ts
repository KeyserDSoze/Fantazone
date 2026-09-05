export const PUBLIC_WEB_ORIGIN = 'https://fanta.plus'

export function publicWebUrl(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${PUBLIC_WEB_ORIGIN}${normalized}`
}
