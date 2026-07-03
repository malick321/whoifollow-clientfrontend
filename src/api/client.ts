import { getAuthHeaders } from '../auth-session'
import { buildLegacyApiUrl, buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const mergedHeaders = {
    ...getAuthHeaders(),
    ...(init?.headers ?? {})
  }

  const response = await fetch(url, {
    ...init,
    headers: mergedHeaders
  })

  if (!response.ok) {
    let body: unknown = null
    let message = `API request failed: ${response.status}`
    try {
      body = await response.json()
      const payload = body as { message?: string }
      if (payload?.message?.trim()) {
        message = payload.message.trim()
      }
    } catch {
      // Fall back to the generic status-based message when the response is not JSON.
    }

    // Hand off to the cross-cutting interceptor for 401 / 403
    // (session expiry / permission revoke). Awaited so a 403
    // triggers `reconcilePermissions` BEFORE the caller's catch
    // block fires — by the time the toast / error UI renders,
    // the cached perms have already been refreshed.
    await interceptApiError(response.status, body)

    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export async function getJson<T>(path: string) {
  return request<T>(buildV2ApiUrl(path))
}

export async function patchJson<T>(path: string, body: unknown) {
  return request<T>(buildV2ApiUrl(path), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

export async function postJson<T>(path: string, body: unknown) {
  return request<T>(buildV2ApiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

export async function putJson<T>(path: string, body: unknown) {
  return request<T>(buildV2ApiUrl(path), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

export async function deleteJson<T>(path: string) {
  return request<T>(buildV2ApiUrl(path), {
    method: 'DELETE'
  })
}

export async function uploadFile<T>(path: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(buildV2ApiUrl(path), {
    method: 'POST',
    headers: {
      ...getAuthHeaders()
    },
    body: formData
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function getLegacyJson<T>(path: string) {
  return request<T>(buildLegacyApiUrl(path))
}

export async function postLegacyJson<T>(path: string, body: unknown) {
  return request<T>(buildLegacyApiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

export async function postLegacyFormData<T>(
  path: string,
  fields: Record<string, string | Blob | File>
) {
  const formData = new FormData()

  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value)
  }

  return request<T>(buildLegacyApiUrl(path), {
    method: 'POST',
    body: formData
  })
}
