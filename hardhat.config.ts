import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import "hardhat-abi-exporter";

dotenv.config();

const { ACCOUNT_PRIVATE_KEY, MNEMONIC, XDAI_RPC_URL } = process.env;

const mnemonic = `${MNEMONIC || "test test test test test test test test test test test junk"}`;

const accounts = ACCOUNT_PRIVATE_KEY
  ? // Private key overrides mnemonic - leave pkey empty in .env if using mnemonic
    [`0x${ACCOUNT_PRIVATE_KEY}`]
  : {
      mnemonic,
      path: "m/44'/60'/0'/0",
      initialIndex: 0,
      count: 10,
    };

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
          metadata: {
            // do not include the metadata hash, since this is machine dependent
            // and we want all generated code to be deterministic
            // https://docs.soliditylang.org/en/v0.7.6/metadata.html
            bytecodeHash: "none",
          },
        },
      },
      { version: "0.4.24" },
      { version: "0.8.6" },
    ],
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://rpc.ankr.com/gnosis`,
        accounts,
        // blockNumber: 21938943,
      },
      gas: "auto",
      chainId: 100,
      timeout: 1800000,
    },
    gnosis: {
      url: XDAI_RPC_URL || "https://rpc.ankr.com/gnosis",
      accounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  typechain: {
    outDir: "artifacts/types",
    target: "ethers-v5",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
};

export default config;
