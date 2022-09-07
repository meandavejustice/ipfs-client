// This is a lightweight ipfs client,
// it's goal is to start with implementing level 0
// from https://number-zero.notion.site/Defining-IPFS-and-IPFS-integrations-1fc599790aa1424889c47d968e2db9d1
// and eventually meet the requirements for level 1.
// Api methods:
/*
open
read
seek
close

Then streams.

example:

const ipfsClient = new IpfsClient({
    gateways: [], // optional
    transport: 'http', // optional
});

const myFile = await ipfsClient.open('cid');
const myFileRead = await ipfsClient.read('cid');

const myFileSeek = await ipfsClient.seek('cid', timecode);

const myFileClosed = await ipfsClient.close('cid');


const myFileReadStream = await ipfsClient.createReadStream('cid');
*/

/* Gateway fetch and ranking code modified from https://github.com/ipfs-shipyard/Durin/blob/main/src/util/ipfs.ts */

import ky from 'ky';
import pMap from 'p-map'
import memo from 'moize'
import orderBy from 'lodash.orderby'
import uniqBy from 'lodash.uniqby'
import { cid, base32cid } from 'is-ipfs'

const MAX_CHECK_INTERVAL = 10000
// QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn is used for health checking: https://github.com/ipfs/go-ipfs/pull/8429/files
const TEST_CID = 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'

export type Node = {
  host: string
  remote: boolean
  healthy: boolean
  speed?: number
}

const DEFAULT_GATEWAY_LIST = [
  { host: 'dweb.link', healthy: true, remote: true },
  { host: 'cf-ipfs.com', healthy: true, remote: true }
];

export const transform = (url: string, node: Partial<Node>) => {
  // support opening just a CID w/ no protocol
  // @ts-ignore
  if (cid(url) || cid(url.split('/')[0].split('?')[0])) url = `ipfs://${url}`

  // catch HTTP urls
  try {
    if (new URL(url).protocol.startsWith('http')) return url
  } catch (_e) {}

  // no protocol, not a CID - assume IPNS
  if (!url.startsWith('ipfs://') && !url.startsWith('ipns://')) url = `ipns://${url}`

  // trim trailing /
  if (url.endsWith('/')) url = url.slice(0, -1)

  let { protocol, hostname, pathname, search } = new URL(url)

  // v0 CID, fix loss of case sensitivity
  if (hostname.startsWith('qm')) {
    const start = url.search(new RegExp(hostname, 'i'))
    hostname = url.slice(start, hostname.length + start)
  }

  const nodeProtocol = node.remote ? 'https' : 'http'

  if (protocol === 'ipfs:') {
    return node.remote && base32cid(hostname)
      ? `${nodeProtocol}://${hostname}.ipfs.${node.host}${pathname}${search}`
      : `${nodeProtocol}://${node.host}/ipfs/${node.host}${pathname}${search}` // use paths on local
  }
  if (protocol === 'ipns:') {
    // use path as per https://github.com/ipfs/infra/issues/506#issuecomment-729850579
    return `${nodeProtocol}://${node.host}/ipns/${hostname}${pathname}${search}`
  }

  throw new Error(`Failed to transform URL: ${url}`)
}

const healthCheck = memo(async (remote: boolean, host: string, port?: number) => {
  try {
    const start = Date.now()
    const url = transform(`ipfs://${TEST_CID}?now=${Date.now()}`, { host, remote, healthy: true })

    const res = await ky.get(url)
    // @ts-ignore
    if (res.status !== 200) return { healthy: false }
    return { healthy: true, speed: Date.now() - start }
  } catch (_) {
    return { healthy: false }
  }
}, { isPromise: true, isDeepEqual: true, maxAge: MAX_CHECK_INTERVAL, maxSize: 100 })

const getNodeStatus = async (node: Partial<Node>): Promise<Node> => {
  const { healthy, speed } = await healthCheck(node.remote!, node.host!)
  return { ...node, healthy, speed } as Node
}

const getNodeList = async (nodes: Partial<Node>[]): Promise<Node[]> =>
  pMap(nodes, getNodeStatus, { concurrency: 6 })

const getRankedNodeList = memo((nodes: Partial<Node>[]) => {
  const ranked = orderBy(uniqBy(nodes, 'host'), [ 'speed' ], 'asc').filter((node: Partial<Node>) => node.healthy)
  return ranked.length === 0 ? [ DEFAULT_GATEWAY_LIST[0] ] : ranked
}, {maxAge: MAX_CHECK_INTERVAL, maxSize: 100})

type IpfsClientProps = {
  chosenGateway: Partial<Node>;
  gateways: Partial<Node>[];
  gatewayCheckInterval: number;
}

export default class IpfsClient {
  public chosenGateway: Partial<Node>;
  public gateways: Partial<Node>[];
  public gatewayCheckInterval: number;

  constructor({
    gatewayCheckInterval = MAX_CHECK_INTERVAL / 2,
    gateways,
    chosenGateway
  }: IpfsClientProps) {
    this.gatewayCheckInterval = gatewayCheckInterval
    this.gateways = gateways
    this.chosenGateway = chosenGateway
  }

  async init() {
    if (!this.gateways) {
      this.gateways = getRankedNodeList(await getNodeList(DEFAULT_GATEWAY_LIST))
    }

    if (!this.chosenGateway && this.gateways.length) {
      this.chosenGateway = this.gateways[0]
    }
  }

  open(url: string) {
    return ky.get(transform(url, this.chosenGateway));
  }

  read(url: string) {
    return ky.get(transform(url, this.chosenGateway));
  }

  seek(url: string) {
    return ky.get(transform(url, this.chosenGateway));
  }
}