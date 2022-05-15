import deployConfig from "../deployConfig";
import { HardhatRuntimeEnvironment } from "hardhat/types";
// import { BigNumber } from "ethers";

module.exports = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Account address:", deployer);

  await deploy("TokenizedVault", {
    from: deployer,
    args: [
      deployConfig.htmContract,
      deployConfig.token,
      deployConfig.gToken,
      deployConfig.gutdContract,
      deployConfig.daoAddress,
      deployConfig.daoAllocationPercent,
      deployConfig.name,
      deployConfig.symbol,
    ],
    log: true,
    // gasPrice: BigNumber.from(20000000000),
  });
};

module.exports.tags = ["TokenizedVault"];
