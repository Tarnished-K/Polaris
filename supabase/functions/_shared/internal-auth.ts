const encoder = new TextEncoder()

function constantTimeStringEqual(actual: string, expected: string): boolean {
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  const length = Math.max(actualBytes.length, expectedBytes.length)
  let difference = actualBytes.length ^ expectedBytes.length

  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }

  return difference === 0
}

export function matchesServiceRoleAuthorization(
  authorization: string | null,
  serviceRoleKey: string
): boolean {
  if (!serviceRoleKey) return false
  return constantTimeStringEqual(authorization ?? '', `Bearer ${serviceRoleKey}`)
}
