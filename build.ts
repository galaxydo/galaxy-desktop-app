import { Installer } from "./installer/mod.ts";

const installer = new Installer({
  out_path: `${Deno.cwd()}/desktop-dist`,
  src_path: `${Deno.cwd()}/GalaxyBrowser`,
  package: {
    product_name: "Galaxy Browser",
    version: "1.1.0",
    description: "Knowledge Management System meets web4 browser on the infinite canvas",
    homepage: "https://github.com/7flash/galaxy-polkadot",
    authors: ["7flash"],
    default_run: "GalaxyBrowser",
  },
  bundle: {
    identifier: "do.galaxy.app",
    icon: ["icon-128x128.jpg"],
    resources: [],
    copyright: "2023",
    short_description: "Galaxy.do: Your decentralized hub for knowledge integration and sharing.",
    long_description: "Galaxy.do stands at the intersection of knowledge and decentralized technology. Our platform empowers users to seamlessly import and adapt repositories, books, and documents, revolutionizing the way we engage with digital content. By allowing creators to mint their insights as NFTs and facilitating effortless Web3 integration, Galaxy.do is not merely a tool. It's the vanguard of a decentralized knowledge movement. Join us in shaping the future of open, democratized information access."
  },
});

await installer.createInstaller();