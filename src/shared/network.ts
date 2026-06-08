/** Detect local IPv4 addresses via WebRTC ICE candidates. */
export function detectLocalIPs(timeoutMs = 1800): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>()
    let pc: RTCPeerConnection | null = null

    const finish = () => {
      try { pc?.close() } catch { /* ignore */ }
      resolve([...found])
    }

    try {
      pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('')
      pc.onicecandidate = (e) => {
        if (!e.candidate) { finish(); return }
        const m = e.candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/)
        if (m) found.add(m[1])
      }
      pc.createOffer()
        .then((o) => pc!.setLocalDescription(o))
        .catch(finish)
    } catch {
      finish()
    }

    setTimeout(finish, timeoutMs)
  })
}

/** Uint32 representation of an IPv4 address string. */
function toU32(ip: string): number {
  return ip.split('.').reduce((n, oct) => ((n << 8) | parseInt(oct, 10)) >>> 0, 0) >>> 0
}

/** True when ip falls within the given CIDR (e.g. "10.0.0.0/8"). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bits = '32'] = cidr.split('/')
  const prefixLen = parseInt(bits, 10)
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0
  return (toU32(ip) & mask) === (toU32(base) & mask)
}

export interface NetworkCheckResult {
  allowed: boolean
  localIPs: string[]
  matchedCidr?: string
}

export async function checkNetworkAccess(cidrs: string[]): Promise<NetworkCheckResult> {
  if (cidrs.length === 0) return { allowed: true, localIPs: [] }
  const localIPs = await detectLocalIPs()
  for (const ip of localIPs) {
    for (const cidr of cidrs) {
      if (ipInCidr(ip, cidr)) return { allowed: true, localIPs, matchedCidr: cidr }
    }
  }
  return { allowed: false, localIPs }
}
