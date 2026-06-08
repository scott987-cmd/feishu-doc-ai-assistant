import './NetworkBlocked.css'

interface Props {
  localIPs: string[]
}

export default function NetworkBlocked({ localIPs }: Props) {
  return (
    <div className="nb-overlay">
      <div className="nb-icon">🔒</div>
      <h2 className="nb-title">访问受限</h2>
      <p className="nb-desc">此扩展仅限内网使用</p>
      <div className="nb-ip-box">
        <span className="nb-ip-label">当前检测到的本机 IP</span>
        <span className="nb-ip-value">
          {localIPs.length > 0 ? localIPs.join('  ·  ') : '未检测到'}
        </span>
      </div>
      <p className="nb-hint">请连接公司内网或 VPN 后重新打开扩展</p>
    </div>
  )
}
