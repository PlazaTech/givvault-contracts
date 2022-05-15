import { ethers } from "hardhat";
import { TokenizedVault } from "../artifacts/types/contracts/TokenizedVault.sol/TokenizedVault";
import { ERC20 } from "../artifacts/types/@rari-capital/solmate/src/tokens/ERC20";
import deployConfig from "../deployConfig";
import { fromETHNumber, getContractAt, toETHNumber } from "./utils/helper";
import { impersonate, mineNBlock } from "./utils/hardhatNode";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer } from "ethers";

describe("TokenizedVault", () => {
  let givToken: ERC20;
  let gGivToken: ERC20;
  let gutdContract: Contract;
  let tv: TokenizedVault;
  let a1: SignerWithAddress;
  let a2: SignerWithAddress;
  let a3: SignerWithAddress;
  let a4: SignerWithAddress;
  let daoImpersonate: Signer;
  const dao = deployConfig.daoAddress;

  const depositAmount = fromETHNumber(10);
  const PPM_DIVISOR = 1e6;

  /// GardenUnipoolTokenDistribution's `earned` value can be less than actual rewards gained by `getRewards`.
  /// Due to this `totalAssets()` and `totalSupplyWithDaoAllocation()` returns lesser than actual assets.
  /// But this different is very small.
  const maxCalculationDifference = 1e5;

  before(async () => {
    [a1, a2, a3, a4] = await ethers.getSigners();
    givToken = await getContractAt<ERC20>(
      "@rari-capital/solmate/src/tokens/ERC20.sol:ERC20",
      deployConfig.token
    );
    gGivToken = await getContractAt<ERC20>(
      "@rari-capital/solmate/src/tokens/ERC20.sol:ERC20",
      deployConfig.gToken
    );
    const gutdInterface = new ethers.utils.Interface([
      "function earned(address account) external view returns (uint256)",
    ]);
    gutdContract = new ethers.Contract(
      deployConfig.gutdContract,
      gutdInterface,
      ethers.provider.getSigner()
    );
    const whale = await impersonate(deployConfig.givWhale);
    daoImpersonate = await impersonate(dao);
    await a1.sendTransaction({ to: deployConfig.givWhale, value: fromETHNumber(1) });
    await a1.sendTransaction({ to: dao, value: fromETHNumber(1) });
    await givToken.connect(whale).transfer(a1.address, fromETHNumber(100));
    await givToken.connect(whale).transfer(a2.address, fromETHNumber(100));
    await givToken.connect(whale).transfer(a3.address, fromETHNumber(100));
  });

  it("Deploy the vault", async () => {
    const TokenizedVault = await ethers.getContractFactory("TokenizedVault");
    tv = (await TokenizedVault.deploy(
      deployConfig.htmContract,
      deployConfig.token,
      deployConfig.gToken,
      deployConfig.gutdContract,
      dao,
      deployConfig.daoAllocationPercent,
      deployConfig.name,
      deployConfig.symbol
    )) as TokenizedVault;
    await tv.deployed();
  });

  it("Check initial state", async () => {
    // calling claimAndStake has no affect. As vault has no pending reward nor token balance
    await tv.claimAndStake();

    expect((await tv.htmContract()).toUpperCase()).to.equal(deployConfig.htmContract.toUpperCase());
    expect((await tv.token()).toUpperCase()).to.equal(deployConfig.token.toUpperCase());
    expect((await tv.gToken()).toUpperCase()).to.equal(deployConfig.gToken.toUpperCase());
    expect((await tv.gutdContract()).toUpperCase()).to.equal(deployConfig.gutdContract.toUpperCase());
    expect((await tv.daoAddress()).toUpperCase()).to.equal(dao.toUpperCase());
    expect(await tv.daoAllocationPercent()).to.equal(deployConfig.daoAllocationPercent);
    expect(await tv.totalAssets()).to.equal(0);
    expect(await tv.totalSupply()).to.equal(0);
    expect(await tv.totalSupplyWithDaoAllocation()).to.equal(0);
    expect(await tv.previewDeposit(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewMint(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewWithdraw(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewRedeem(depositAmount)).to.equal(depositAmount);
  });

  it("deposit: Should be able to deposit giv and wrap", async () => {
    const oldGivBal = await givToken.balanceOf(tv.address);
    const oldGGivBal = await gGivToken.balanceOf(tv.address);
    const expectedDeposit = await tv.previewDeposit(depositAmount);

    await givToken.approve(tv.address, depositAmount);
    const tx = await tv.deposit(depositAmount, a1.address);

    await expect(tx)
      .to.emit(gGivToken, "Transfer")
      .withArgs(ethers.constants.AddressZero, tv.address, depositAmount);

    const newGivBal = await givToken.balanceOf(tv.address);
    const newGGivBal = await gGivToken.balanceOf(tv.address);

    expect(newGivBal).to.equal(oldGivBal).to.equal(0);
    expect(newGGivBal.sub(oldGGivBal)).to.equal(depositAmount);
    expect(await tv.totalAssets())
      .to.equal(depositAmount)
      .to.equal(expectedDeposit);
    expect(await tv.totalSupply())
      .to.equal(depositAmount)
      .to.equal(await gGivToken.balanceOf(tv.address));
    expect(await tv.totalSupplyWithDaoAllocation()).to.equal(depositAmount);
    expect(await tv.previewDeposit(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewMint(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewWithdraw(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewRedeem(depositAmount)).to.equal(depositAmount);
    expect(await givToken.balanceOf(tv.address)).to.equal(0);
  });

  it("After sometime totalAssets > totalSupply", async () => {
    const assets = fromETHNumber(10);

    await mineNBlock(10, 1000);

    // Rough estimations
    expect(await tv.totalSupply()).to.equal(assets);
    expect(await tv.totalAssets()).gt(assets);
    expect(await tv.previewDeposit(depositAmount)).lt(depositAmount);
    expect(await tv.previewMint(depositAmount)).gt(depositAmount);
    expect(await tv.previewWithdraw(depositAmount)).lt(depositAmount);
    expect(await tv.previewRedeem(depositAmount)).gt(depositAmount);

    // Exact calculations
    const earned = await gutdContract.earned(tv.address);
    const daoAllocation = earned.mul(deployConfig.daoAllocationPercent).div(PPM_DIVISOR);
    const earnedWithDaoAllocation = earned.sub(daoAllocation);
    const calculatedTotalSupply = (await gGivToken.balanceOf(tv.address)).add(earned);
    const calculatedTotalSupplyWithDaoAllocation = (await gGivToken.balanceOf(tv.address)).add(
      earnedWithDaoAllocation
    );
    expect(await tv.totalAssets()).to.equal(calculatedTotalSupply);
    expect(await tv.totalSupplyWithDaoAllocation()).to.equal(calculatedTotalSupplyWithDaoAllocation);
  });

  it("claimAndStake: Should be able to claim reward and stake again, and transfer dao allocation", async () => {
    const oldGivBal = await givToken.balanceOf(tv.address);
    const oldGGivBal = await gGivToken.balanceOf(tv.address);
    const oldDaoGivBalance = await givToken.balanceOf(dao);
    const oldEarned = await gutdContract.earned(tv.address);

    const tx = await tv.claimAndStake();
    const receipt = await tx.wait();

    // @ts-ignore
    const earned = receipt.events[0].args.amount; // from the first event of `getReward`. Req for exact figure.
    const daoAllocation = earned.mul(deployConfig.daoAllocationPercent).div(PPM_DIVISOR);
    const earnedWithDaoAllocation = earned.sub(daoAllocation);

    expect(earned).to.be.above(oldEarned);
    await expect(tx).to.emit(tv, "ClaimAndStake").withArgs(earnedWithDaoAllocation, daoAllocation);
    await expect(tx)
      .to.emit(gGivToken, "Transfer")
      .withArgs(ethers.constants.AddressZero, tv.address, earnedWithDaoAllocation);
    await expect(tx).to.emit(givToken, "Transfer").withArgs(tv.address, dao, daoAllocation);

    const newGivBal = await givToken.balanceOf(tv.address);
    const newGGivBal = await gGivToken.balanceOf(tv.address);
    const newDaoGivBalance = await givToken.balanceOf(dao);

    expect(newGivBal).to.equal(oldGivBal).to.equal(0);
    expect(newGGivBal.sub(oldGGivBal)).to.equal(earnedWithDaoAllocation);
    expect(newDaoGivBalance.sub(oldDaoGivBalance)).to.equal(daoAllocation);
  });

  it("redeem: Should be able to redeem giv, unwrap, and claim and reStake.", async () => {
    const oldDaoGivBal = toETHNumber(await givToken.balanceOf(dao));
    const oldUserGivBal = toETHNumber(await givToken.balanceOf(a1.address));
    const expectedAssets = toETHNumber(await tv.previewRedeem(depositAmount));

    const tx = await tv.redeem(depositAmount, a1.address, a1.address);
    const receipt = await tx.wait();

    // @ts-ignore
    const earned = receipt.events[0].args.amount; // from the first event of `getReward`. Req for exact figure.
    const daoAllocation = toETHNumber(earned.mul(deployConfig.daoAllocationPercent).div(PPM_DIVISOR));
    const newDaoGivBal = toETHNumber(await givToken.balanceOf(dao));
    const newUserGivBal = toETHNumber(await givToken.balanceOf(a1.address));
    const newGivBal = await givToken.balanceOf(tv.address);
    const newGGivBal = await gGivToken.balanceOf(tv.address);

    expect(
      Math.abs(
        (maxCalculationDifference * (newUserGivBal - oldUserGivBal - expectedAssets)) / expectedAssets
      )
    ).to.be.below(1);
    expect(
      Math.abs((maxCalculationDifference * (newDaoGivBal - oldDaoGivBal - daoAllocation)) / daoAllocation)
    ).to.be.below(1);
    expect(newGivBal).to.equal(0);
    expect(newGGivBal).to.equal(0);
    expect(await tv.totalAssets()).to.equal(0);
    expect(await tv.totalSupply()).to.equal(0);
    expect(await tv.totalSupplyWithDaoAllocation()).to.equal(0);
    expect(await tv.previewDeposit(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewMint(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewWithdraw(depositAmount)).to.equal(depositAmount);
    expect(await tv.previewRedeem(depositAmount)).to.equal(depositAmount);

    // Checking math
    expect(maxCalculationDifference * 1e-5).to.be.equal(1);
    expect(maxCalculationDifference * 1e-4).to.be.above(1);
  });

  it("multiple deposit and redeem", async () => {
    // deposit #1
    const oldA1GivBalance = await givToken.balanceOf(a1.address);
    const oldA2GivBalance = await givToken.balanceOf(a2.address);
    const oldA3GivBalance = await givToken.balanceOf(a3.address);
    const oldDaoGivBalance = await givToken.balanceOf(dao);

    expect(await givToken.balanceOf(tv.address)).to.equal(0);
    expect(await gGivToken.balanceOf(tv.address)).to.equal(0);
    expect(await tv.totalAssets()).to.equal(0);
    expect(await tv.totalSupply()).to.equal(0);

    await givToken.approve(tv.address, depositAmount);
    await tv.deposit(depositAmount, a1.address);

    // deposit #2
    await mineNBlock(10, 1000);
    await givToken.connect(a2).approve(tv.address, depositAmount);
    await tv.connect(a2).deposit(depositAmount, a2.address);

    // redeem #1
    await mineNBlock(10, 1000);
    await tv.redeem(await tv.balanceOf(a1.address), a1.address, a1.address);

    // deposit #3
    await mineNBlock(10, 1000);
    await givToken.connect(a3).approve(tv.address, depositAmount);
    await tv.connect(a3).deposit(depositAmount, a3.address);

    // redeem #2
    await mineNBlock(10, 1000);
    await tv.connect(a2).redeem(await tv.balanceOf(a2.address), a2.address, a2.address);

    // redeem #3
    await mineNBlock(10, 1000);
    await tv.connect(a3).redeem(await tv.balanceOf(a3.address), a3.address, a3.address);

    const newA1GivBalance = await givToken.balanceOf(a1.address);
    const newA2GivBalance = await givToken.balanceOf(a2.address);
    const newA3GivBalance = await givToken.balanceOf(a3.address);
    const newDaoGivBalance = await givToken.balanceOf(dao);

    expect(await givToken.balanceOf(tv.address)).to.equal(0);
    expect(await gGivToken.balanceOf(tv.address)).to.equal(0);
    expect(await tv.totalAssets()).to.equal(0);
    expect(await tv.totalSupply()).to.equal(0);
    expect(newA1GivBalance).to.be.above(oldA1GivBalance);
    expect(newA2GivBalance).to.be.above(oldA2GivBalance);
    expect(newA3GivBalance).to.be.above(oldA3GivBalance);
    expect(newDaoGivBalance).to.be.above(oldDaoGivBalance);
  });

  it("should not wrap any giv token (lost fund) directly transferred to the contract", async () => {
    const transferredAmount = 1;
    await givToken.transfer(tv.address, transferredAmount);

    const tx = await tv.connect(daoImpersonate).claimAndStake();

    await expect(tx).to.not.emit(tv, "ClaimAndStake");
    await expect(tx).to.not.emit(tv, "RecoveredERC20");

    expect(await tv.totalAssets()).to.be.equal(0);
    expect(await tv.totalSupply()).to.equal(0);
  });

  it("dao should be able to recover lost token", async () => {
    const transferredAmount = 1;

    const oldDaoBalance = await givToken.balanceOf(dao);

    const tx = await tv.connect(daoImpersonate).recoverERC20(givToken.address, dao);

    await expect(tx)
      .to.emit(tv, "RecoveredERC20")
      .withArgs(ethers.utils.getAddress(givToken.address), transferredAmount, ethers.utils.getAddress(dao));
    const newDaoBalance = await givToken.balanceOf(dao);
    expect(newDaoBalance.sub(oldDaoBalance)).to.equal(transferredAmount);
  });

  it("revert when any sender other than dao tries to recover lost token", async () => {
    await expect(tv.recoverERC20(givToken.address, dao)).to.be.revertedWith("TV::sender is not daoAddress");
  });

  it("revert when try to recover governance token(gGiv)", async () => {
    await expect(tv.connect(daoImpersonate).recoverERC20(gGivToken.address, dao)).to.be.revertedWith(
      "TV::cannot recover governance token"
    );
  });
});
