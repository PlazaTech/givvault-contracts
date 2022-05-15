// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@rari-capital/solmate/src/mixins/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHookedTokenManager {
    function wrap(uint256) external;

    function unwrap(uint256) external;
}

interface IGardenUnipoolTokenDistributor is IERC20 {
    function getReward() external;

    function earned(address account) external view returns (uint256);
}

/// @author @parv3213
contract TokenizedVault is ERC4626 {
    using SafeTransferLib for ERC20;
    using FixedPointMathLib for uint256;

    event ClaimAndStake(uint256 reStaked, uint256 daoAllocation);
    event RecoveredERC20(address _asset, uint256 _assetBalance, address _receiver);

    // HookedTokenManager
    address public htmContract; // Gnosis Chain: 0x24f2d06446af8d6e89febc205e7936a602a87b60

    // For ex: Giv Token
    address public token; // Gnosis Chain: 0x4f4f9b8d5b4d0dc10506e5551b0513b61fd59e75

    // For ex: gGiv Token
    address public gToken; //Gnosis Chain: 0xfFBAbEb49be77E5254333d5fdfF72920B989425f

    // GardenUnipoolTokenDistributor
    address public gutdContract; //Gnosis Chain: 0xd93d3bdba18ebcb3317a57119ea44ed2cf41c2f2

    // Dao address
    address public daoAddress;

    /// @notice percent, in PPM, applicable on rewards earned. This is used for DAO maintenance.
    uint256 public daoAllocationPercent;

    uint256 internal constant PPM_DIVISOR = 1e6;

    constructor(
        address _htmContract,
        address _token,
        address _gToken,
        address _gutdContract,
        address _daoAddress,
        uint256 _daoAllocationPercent,
        string memory _name,
        string memory _symbol
    ) ERC4626(ERC20(_token), _name, _symbol) {
        htmContract = _htmContract;
        token = _token;
        gToken = _gToken;
        gutdContract = _gutdContract;
        daoAddress = _daoAddress;
        daoAllocationPercent = _daoAllocationPercent;
    }

    function recoverERC20(address _asset, address _receiver) public {
        require(msg.sender == daoAddress, "TV::sender is not daoAddress");
        require(_asset != gToken, "TV::cannot recover governance token");
        uint256 _assetBalance = IERC20(_asset).balanceOf(address(this));
        IERC20(_asset).transfer(_receiver, _assetBalance);
        emit RecoveredERC20(_asset, _assetBalance, _receiver);
    }

    function totalAssets() public view override returns (uint256) {
        return
            IERC20(gToken).balanceOf(address(this)) +
            IGardenUnipoolTokenDistributor(gutdContract).earned(address(this));
    }

    function claimAndStake() public {
        uint256 _oldGivBalance = IERC20(token).balanceOf(address(this));

        if (IGardenUnipoolTokenDistributor(gutdContract).earned(address(this)) > 0) {
            IGardenUnipoolTokenDistributor(gutdContract).getReward();
            // we do not want to wrap _oldGivBalance (as these are lost funds that affects future calculations)
            uint256 _givBalance = IERC20(token).balanceOf(address(this)) - _oldGivBalance;
            uint256 _daoAllocation = (_givBalance * daoAllocationPercent) / PPM_DIVISOR;
            uint256 _reStakeAmount = _givBalance - _daoAllocation;
            IERC20(token).transfer(daoAddress, _daoAllocation);
            IERC20(token).approve(htmContract, _reStakeAmount);
            IHookedTokenManager(htmContract).wrap(_reStakeAmount);
            emit ClaimAndStake(_reStakeAmount, _daoAllocation);
        }
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256 shares) {
        claimAndStake();

        ///-- START: same code as ERC4626.sol --///
        shares = previewWithdraw(assets); // No need to check for rounding error, previewWithdraw rounds up.

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender]; // Saves gas for limited approvals.

            if (allowed != type(uint256).max) allowance[owner][msg.sender] = allowed - shares;
        }

        beforeWithdraw(assets, shares);

        _burn(owner, shares);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);

        asset.safeTransfer(receiver, assets);
        ///-- END: same code as ERC4626.sol --///
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public virtual override returns (uint256 assets) {
        claimAndStake();

        ///-- START: same code as ERC4626.sol --///
        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender]; // Saves gas for limited approvals.

            if (allowed != type(uint256).max) allowance[owner][msg.sender] = allowed - shares;
        }

        // Check for rounding error since we round down in previewRedeem.
        require((assets = previewRedeem(shares)) != 0, "ZERO_ASSETS");

        beforeWithdraw(assets, shares);

        _burn(owner, shares);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);

        asset.safeTransfer(receiver, assets);
        ///-- END: same code as ERC4626.sol --///
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply; // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? assets : assets.mulDivDown(supply, totalSupplyWithDaoAllocation());
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply; // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? shares : shares.mulDivUp(totalSupplyWithDaoAllocation(), supply);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply; // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? assets : assets.mulDivUp(supply, totalSupplyWithDaoAllocation());
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply; // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? shares : shares.mulDivDown(totalSupplyWithDaoAllocation(), supply);
    }

    function totalSupplyWithDaoAllocation() public view returns (uint256) {
        uint256 _earned = IGardenUnipoolTokenDistributor(gutdContract).earned(address(this));
        uint256 _earnedWithoutDaoAllocation;
        if (_earned > 0) {
            _earnedWithoutDaoAllocation = _earned - (_earned * daoAllocationPercent) / PPM_DIVISOR;
            return IERC20(gToken).balanceOf(address(this)) + _earnedWithoutDaoAllocation;
        } else {
            return IERC20(gToken).balanceOf(address(this));
        }
    }

    function afterDeposit(uint256 _assets, uint256) internal virtual override {
        IERC20(token).approve(htmContract, _assets);
        IHookedTokenManager(htmContract).wrap(_assets);
    }

    function beforeWithdraw(uint256 _assets, uint256) internal virtual override {
        IHookedTokenManager(htmContract).unwrap(_assets);
    }
}
