// Where to add a DNS record, provider by provider, for people who have never
// done it. The server says who runs the domain's DNS (api/domains.ts reads the
// nameservers), so the right guide opens on its own.
//
// Each step is plain text; {name}, {type} and {value} are filled from the
// record being shown. `fullName` providers want the whole host in the name
// field ("blog.kontra.run"), the rest only the part before the domain ("blog").

export interface DnsGuide {
  id: string;
  label: string;
  /** Where the DNS records are, as a link. */
  url?: string;
  fullName?: boolean;
  steps: string[];
  /** Said once, under the steps. */
  note?: string;
}

export const DNS_GUIDES: DnsGuide[] = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    url: "https://dash.cloudflare.com/",
    steps: [
      "Open Cloudflare, pick your domain, then DNS › Records.",
      "Click Add record. Type: {type}. Name: {name}. Target or content: {value}.",
      "For the CNAME, click the orange cloud so it turns grey and says DNS only.",
      "Save.",
    ],
    note: "The cloud must be grey (DNS only). With the orange proxy on, the certificate can't be issued.",
  },
  {
    id: "godaddy",
    label: "GoDaddy",
    url: "https://dcc.godaddy.com/control/portfolio",
    steps: [
      "Open GoDaddy, find your domain and choose DNS (Manage DNS).",
      "Click Add New Record. Type: {type}. Name: {name}. Value: {value}.",
      "Leave TTL as it is and save.",
    ],
  },
  {
    id: "namecheap",
    label: "Namecheap",
    url: "https://ap.www.namecheap.com/domains/list/",
    steps: [
      "Open Namecheap, click Manage next to your domain, then Advanced DNS.",
      "Click Add New Record. Type: {type} Record. Host: {name}. Value or target: {value}.",
      "Click the green tick to save.",
    ],
  },
  {
    id: "squarespace",
    label: "Squarespace (ex Google Domains)",
    url: "https://account.squarespace.com/domains",
    steps: [
      "Open Squarespace Domains, pick your domain, then DNS › DNS Settings.",
      "Under Custom records, click Add record. Host: {name}. Type: {type}. Data: {value}.",
      "Save.",
    ],
  },
  {
    id: "route53",
    label: "Amazon Route 53",
    url: "https://console.aws.amazon.com/route53/v2/hostedzones",
    fullName: true,
    steps: [
      "Open Route 53 › Hosted zones and pick your domain.",
      "Click Create record. Record name: {name}. Record type: {type}. Value: {value}.",
      "For the TXT record, put the value in double quotes. Create records.",
    ],
  },
  {
    id: "porkbun",
    label: "Porkbun",
    url: "https://porkbun.com/account/domainsSpeedy",
    steps: [
      "Open Porkbun, click Details next to your domain, then DNS.",
      "Type: {type}. Host: {name}. Answer: {value}. Click Add.",
    ],
  },
  {
    id: "ovh",
    label: "OVHcloud",
    url: "https://www.ovh.com/manager/",
    steps: [
      "Open the OVHcloud Control Panel › Web Cloud › Domain names, pick your domain, then DNS zone.",
      "Click Add an entry, choose {type}. Sub-domain: {name}. Target or value: {value}.",
      "Confirm. OVH can take a few minutes to apply it.",
    ],
  },
  {
    id: "gandi",
    label: "Gandi",
    url: "https://admin.gandi.net/domain/",
    steps: [
      "Open Gandi, pick your domain, then DNS Records.",
      "Click Add record. Type: {type}. Name: {name}. Value: {value}. Create.",
    ],
  },
  {
    id: "hostinger",
    label: "Hostinger",
    url: "https://hpanel.hostinger.com/domains",
    steps: [
      "Open hPanel › Domains, pick your domain, then DNS / Nameservers.",
      "Under Manage DNS records: Type: {type}. Name: {name}. Points to or TXT value: {value}. Add record.",
    ],
  },
  {
    id: "ionos",
    label: "IONOS",
    url: "https://my.ionos.com/domains",
    steps: [
      "Open IONOS › Domains & SSL, click the gear next to your domain, then DNS.",
      "Click Add record, choose {type}. Host name: {name}. Points to or value: {value}. Save.",
    ],
  },
  {
    id: "vercel",
    label: "Vercel",
    url: "https://vercel.com/dashboard/domains",
    steps: [
      "Open Vercel › Domains and pick your domain.",
      "Add a DNS record. Name: {name}. Type: {type}. Value: {value}. Add.",
    ],
  },
  {
    id: "wix",
    label: "Wix",
    url: "https://manage.wix.com/account/domains",
    steps: [
      "Open Wix › Domains, click the three dots next to your domain, then Manage DNS records.",
      "In the {type} section, click Add record. Host name: {name}. Value or points to: {value}. Save.",
    ],
  },
  {
    id: "namecom",
    label: "Name.com",
    url: "https://www.name.com/account/domain",
    steps: [
      "Open Name.com, pick your domain, then Manage DNS records.",
      "Type: {type}. Host: {name}. Answer: {value}. Add record.",
    ],
  },
  {
    id: "digitalocean",
    label: "DigitalOcean",
    url: "https://cloud.digitalocean.com/networking/domains",
    steps: [
      "Open DigitalOcean › Networking › Domains and pick your domain.",
      "Choose the {type} tab. Hostname: {name}. Value or alias: {value}. Create record.",
    ],
  },
  {
    id: "other",
    label: "Another provider",
    steps: [
      "Sign in where you bought the domain (or wherever its DNS is managed) and find DNS, DNS records or Zone editor.",
      "Add a record. Type: {type}. Name or host: {name}. Value, target or points to: {value}.",
      "Save. If the name field already shows your domain after it, type only {name}.",
    ],
    note: "Not sure where your DNS is? Forward this page to whoever set up your website: it's a two-minute job for them.",
  },
];

export function guideFor(provider: string): DnsGuide {
  return DNS_GUIDES.find((g) => g.id === provider) ?? DNS_GUIDES[DNS_GUIDES.length - 1];
}

export function fillStep(step: string, record: { type: string; name: string; value: string }): string {
  return step.replace(/\{type\}/g, record.type).replace(/\{name\}/g, record.name).replace(/\{value\}/g, record.value);
}
