// Link resmi per bridge/tool key yang LI.FI bisa pilih (lihat /v1/tools).
// Dipakai biar user bisa langsung klik buat verifikasi manual - bukan
// exhaustive, tool yang gak ke-map jatuh ke fallback Jumper Exchange
// (produk consumer-facing LI.FI sendiri, selalu valid buat rute apa pun
// yang LI.FI temuin, apapun tool spesifiknya).
const BRIDGE_LINKS = {
  cbridge: 'https://cbridge.celer.network',
  celercircle: 'https://cbridge.celer.network',
  celercirclefast: 'https://cbridge.celer.network',
  arbitrum: 'https://bridge.arbitrum.io',
  across: 'https://across.to',
  gnosis: 'https://bridge.gnosischain.com',
  omni: 'https://omni.network',
  allbridge: 'https://allbridge.io',
  squid: 'https://app.squidrouter.com',
  mayan: 'https://swap.mayan.finance',
  mayanWH: 'https://swap.mayan.finance',
  mayanMCTP: 'https://swap.mayan.finance',
  mayanFastMCTP: 'https://swap.mayan.finance',
  stargateV2: 'https://stargate.finance',
  stargateV2Bus: 'https://stargate.finance',
  symbiosis: 'https://app.symbiosis.finance',
  polygon: 'https://portal.polygon.technology',
  glacis: 'https://www.glacislabs.com',
  chainflip: 'https://swap.chainflip.io',
  gasZipBridge: 'https://www.gas.zip',
  relaydepository: 'https://relay.link',
  polymer: 'https://polymerlabs.org',
  polymerStandard: 'https://polymerlabs.org',
  hyperliquidSA: 'https://app.hyperliquid.xyz/bridge',
  hyperliquidNative: 'https://app.hyperliquid.xyz/bridge',
  garden: 'https://garden.finance',
  paxos: 'https://paxos.com',
  layerswap: 'https://layerswap.io',
}

const FALLBACK_LINK = 'https://jumper.exchange'

export function bridgeLinkFor(bridgeKey) {
  return BRIDGE_LINKS[bridgeKey] ?? FALLBACK_LINK
}
