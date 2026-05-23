// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FeeRouter
 * @notice Collects a protocol fee and forwards the net amount to Circle's CCTP V2
 *         TokenMessenger in a single user transaction.
 *
 * Flow:
 *   1. User approves FeeRouter for `grossAmount` USDC.
 *   2. User calls bridge() — FeeRouter pulls grossAmount, transfers feeAmount to
 *      feeRecipient, then calls TokenMessenger.depositForBurn (CCTP V2) with netAmount.
 *   3. Attestation + mint happens off-chain as normal CCTP flow.
 *
 * Owner can update feeBps and feeRecipient at any time.
 * Max fee is capped at 5% (500 bps) to protect users.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev CCTP V2 TokenMessenger — selector 0x8e0250ee (7 params)
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold
    ) external returns (uint64 nonce);
}

contract FeeRouter {
    address public owner;
    address public feeRecipient;
    uint256 public feeBps;
    uint256 public constant MAX_FEE_BPS = 500; // 5% hard cap

    event BridgeInitiated(
        address indexed sender,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 bridgeAmount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address usdc,
        address tokenMessenger
    );
    event FeeUpdated(uint256 oldBps, uint256 newBps);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event OwnershipTransferred(address oldOwner, address newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "FeeRouter: not owner");
        _;
    }

    constructor(address _feeRecipient, uint256 _feeBps) {
        require(_feeRecipient != address(0), "FeeRouter: zero fee recipient");
        require(_feeBps <= MAX_FEE_BPS, "FeeRouter: fee too high");
        owner        = msg.sender;
        feeRecipient = _feeRecipient;
        feeBps       = _feeBps;
    }

    /**
     * @notice Bridge USDC cross-chain via CCTP V2 with fee deduction.
     * @param grossAmount          Total USDC (6 decimals) to pull from caller.
     * @param destinationDomain    CCTP domain ID of the destination chain.
     * @param mintRecipient        32-byte padded recipient address on destination.
     * @param usdc                 USDC contract address on this chain.
     * @param tokenMessenger       Circle CCTP V2 TokenMessenger on this chain.
     * @param minFinalityThreshold CCTP V2 finality threshold (2000=finalized, 1000=safe).
     */
    function bridge(
        uint256 grossAmount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address usdc,
        address tokenMessenger,
        uint32  minFinalityThreshold
    ) external returns (uint64 nonce) {
        require(grossAmount > 0, "FeeRouter: zero amount");

        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), grossAmount),
            "FeeRouter: transferFrom failed"
        );

        uint256 feeAmount    = (grossAmount * feeBps) / 10000;
        uint256 bridgeAmount = grossAmount - feeAmount;
        require(bridgeAmount > 0, "FeeRouter: bridge amount zero");

        if (feeAmount > 0) {
            require(
                IERC20(usdc).transfer(feeRecipient, feeAmount),
                "FeeRouter: fee transfer failed"
            );
        }

        require(
            IERC20(usdc).approve(tokenMessenger, bridgeAmount),
            "FeeRouter: approve failed"
        );

        // CCTP V2: destinationCaller=0 (anyone may relay), maxFee=0 (no premium)
        nonce = ITokenMessengerV2(tokenMessenger).depositForBurn(
            bridgeAmount,
            destinationDomain,
            mintRecipient,
            usdc,
            bytes32(0),          // destinationCaller = anyone
            0,                   // maxFee = 0
            minFinalityThreshold
        );

        emit BridgeInitiated(
            msg.sender,
            grossAmount,
            feeAmount,
            bridgeAmount,
            destinationDomain,
            mintRecipient,
            usdc,
            tokenMessenger
        );
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "FeeRouter: fee too high");
        emit FeeUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "FeeRouter: zero address");
        emit FeeRecipientUpdated(feeRecipient, _feeRecipient);
        feeRecipient = _feeRecipient;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "FeeRouter: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
