import { BigNumber } from "ethers";
import { ethers } from "hardhat";

export async function getContractAt<Type>(typeName: string, address: string): Promise<Type> {
  const ctr = (await ethers.getContractAt(typeName, address)) as unknown as Type;
  return ctr;
}

export const toETHNumber = (num: BigNumber | string): number => {
  return typeof num == "string"
    ? Number.parseFloat(num as string)
    : Number.parseFloat(ethers.utils.formatEther(num));
};

export const fromETHNumber = (num: number): BigNumber => {
  return ethers.utils.parseEther(num.toString());
};
