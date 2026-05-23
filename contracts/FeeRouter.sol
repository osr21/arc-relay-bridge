// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FeeRouter
 * @notice Collects a protocol fee and forwards the net amount to Circle's CCTP
 *         TokenMessenger in a single user transaction.
 *
 * Flow:
 *   1. User approves FeeRouter for `grossAmount` USDC.
 *   2. User calls bridge() — FeeRouter pulls grossAmount, transfers feeAmount to
 *      feeRecipient, then calls TokenMessenger.depositForBurn with netAmount.
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

interface ITokenMessenger {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);
}

contract FeeRouter {
    address public owner;
    address public feeRecipient;
    uint256 public feeBps;          // e.g. 30 = 0.30%
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
     * @notice Bridge USDC cross-chain via CCTP with fee deduction.
     * @param grossAmount       Total USDC (6 decimals) to pull from caller.
     * @param destinationDomain CCTP domain ID of the destination chain.
     * @param mintRecipient     32-byte padded recipient address on destination.
     * @param usdc              USDC contract address on this chain.
     * @param tokenMessenger    Circle TokenMessenger contract on this chain.
     */
    function bridge(
        uint256 grossAmount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address usdc,
        address tokenMessenger
    ) external returns (uint64 nonce) {
        require(grossAmount > 0, "FeeRouter: zero amount");

        // Pull full gross amount from sender
        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), grossAmount),
            "FeeRouter: transferFrom failed"
        );

        // Calculate fee
        uint256 feeAmount    = (grossAmount * feeBps) / 10000;
        uint256 bridgeAmount = grossAmount - feeAmount;
        require(bridgeAmount > 0, "FeeRouter: bridge amount zero");

        // Send fee to recipient
        if (feeAmount > 0) {
            require(
                IERC20(usdc).transfer(feeRecipient, feeAmount),
                "FeeRouter: fee transfer failed"
            );
        }

        // Approve TokenMessenger to spend bridgeAmount
        require(
            IERC20(usdc).approve(tokenMessenger, bridgeAmount),
            "FeeRouter: approve failed"
        );

        // Initiate CCTP burn
        nonce = ITokenMessenger(tokenMessenger).depositForBurn(
            bridgeAmount,
            destinationDomain,
            mintRecipient,
            usdc
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

    // ── Admin ──────────────────────────────────────────────────────────────

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

    /**
     * @notice Emergency rescue for any ERC-20 accidentally sent to this contract.
     *         Should never hold funds — everything is atomic — but just in case.
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
