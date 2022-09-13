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
import isIPFS from 'is-ipfs';
import orderBy from 'lodash.orderby'
import uniqBy from 'lodash.uniqby'
// @ts-ignore
import cat from 'cat';
const { cid } = isIPFS;

const MAX_CHECK_INTERVAL = 10000
// QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn is used for health checking: https://github.com/ipfs/go-ipfs/pull/8429/files
const TEST_CID = 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'
const DEFAULT_GATEWAY_LIST = [
  { host: 'dweb.link', healthy: true, speed: 0 },
  { host: 'cf-ipfs.com', healthy: true, speed: 0 }
];

export type Node = {
  host: string
  healthy: boolean
  speed: number
}

export const transform = (url: string, node: Node) => {
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

  if (protocol === 'ipfs:') {
    return `https://${hostname}.ipfs.${node.host}${pathname}${search}`
  }

  if (protocol === 'ipns:') {
    // use path as per https://github.com/ipfs/infra/issues/506#issuecomment-729850579
    return `https://${node.host}/ipns/${hostname}${pathname}${search}`
  }

  throw new Error(`Failed to transform URL: ${url}`)
}

const healthCheck = memo(async (host: string, speed: number) => {
  try {
    const start = Date.now()
    const url = transform(`ipfs://${TEST_CID}?now=${Date.now()}`, { host, healthy: true, speed })

    const res = await ky.get(url)
    // @ts-ignore
    if (res.status !== 200) return { healthy: false }
    return { healthy: true, speed: Date.now() - start }
  } catch (_) {
    return { healthy: false }
  }
}, { isPromise: true, isDeepEqual: true, maxAge: MAX_CHECK_INTERVAL, maxSize: 100 })

const getNodeStatus = async (node: Node): Promise<Node> => {
  const { healthy, speed } = await healthCheck(node.host!, node.speed)
  return { ...node, healthy, speed } as Node
}

const getNodeList = async (nodes: Node[]): Promise<Node[]> =>
  pMap(nodes, getNodeStatus, { concurrency: 6 })

const getRankedNodeList = memo((nodes: Node[]) => {
  const ranked = orderBy(uniqBy(nodes, 'host'), [ 'speed' ], 'asc').filter((node: Node) => node.healthy)
  return ranked.length === 0 ? [ DEFAULT_GATEWAY_LIST[0] ] : ranked
}, {maxAge: MAX_CHECK_INTERVAL, maxSize: 100})

function catAsync(url: string) {
  return new Promise(function(resolve, reject) {
    cat(url, function(err: Error, data: any) {
      if (err !== null) reject(err);
      else resolve(data)
    });
  });
}

export default class IpfsClient {
  chosenGateway = DEFAULT_GATEWAY_LIST[0];
  gateways = DEFAULT_GATEWAY_LIST;
  gatewayCheckInterval = MAX_CHECK_INTERVAL / 2;

  async init() {
    this.gateways = getRankedNodeList(await getNodeList(DEFAULT_GATEWAY_LIST))
    this.chosenGateway = this.gateways[0]
  }

  // open(url: string) {
  //   console.log("Opening.... ", transform(url, this.chosenGateway));
  //   return ky.get(transform(url, this.chosenGateway));
  // }

  async read(url: string) {
    return await catAsync(transform(url, this.chosenGateway))
  }

  // seek(url: string) {
  //   console.log("Seeking.... ", transform(url, this.chosenGateway));
  //   return ky.get(transform(url, this.chosenGateway));
  // }
}