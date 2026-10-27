// The trademark notice under every signed-in HD and Reefer screen. One component so the
// /hd and /reefer layouts cannot drift apart.
export default function HDTrademarkFooter() {
  return (
    <footer style={{ background: 'var(--hd-footer)', borderTop: '1px solid var(--hd-footer-border)', width: '100%' }}>
      <p style={{ color: 'var(--hd-text-faint)', fontSize: '11px', padding: '16px', textAlign: 'center', lineHeight: '1.6', maxWidth: 900, margin: '0 auto' }}>
        Thermo King and TK are registered trademarks of Thermo King Corporation. Carrier, Transicold, Supra, and Vector are registered trademarks of Carrier Corporation. Yanmar is a registered trademark of Yanmar Holdings Co., Ltd. Delco Remy is a registered trademark of BorgWarner Inc. National Wrench Index HD Suite is an independent service tool and is not affiliated with, endorsed by, or sponsored by any manufacturer referenced herein. Always verify specifications against official manufacturer documentation before performing service.
      </p>
    </footer>
  )
}
