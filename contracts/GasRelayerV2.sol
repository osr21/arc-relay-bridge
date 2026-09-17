// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20V2 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IMessageTransmitterV2 {
    /// @notice Validates a Circle CCTP V2 attestation and executes the mint.
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/**
 * @title GasRelayerV2
 * @notice Relays a strictly formatted CCTP V2 burn-with-hook message and pays
 *         its attested hook recipient after deducting a bounded flat USDC fee.
 * @dev This is intentionally a new contract. It neither accepts CCTP V1
 *      messages nor changes the legacy GasRelayer deployment/ABI.
 *
 * The source burn MUST use depositForBurnWithHook with:
 *   mintRecipient      = bytes32(uint256(uint160(address(this))))
 *   destinationCaller  = bytes32(uint256(uint160(address(this))))
 *   hookData           = abi.encode(address recipient, uint256 maxRelayFee)
 *
 * CCTP V2 message layout is a 148-byte header followed by a 228-byte
 * BurnMessageV2 body. This application accepts only the 64-byte ABI hook,
 * making the complete message exactly 440 bytes.
 */
contract GasRelayerV2 {
    address public immutable usdc;
    address public immutable messageTransmitter;

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    uint256 public relayFee; // USDC atomic units (6 decimals for native USDC)
    bool public paused;

    bool private _locked;

    /// @notice Version marker for deployment/configuration verification.
    string public constant RELAYER_PROTOCOL_VERSION = "gas-relayer-v2/cctp-v2-hook-v1";

    uint256 public constant MAX_RELAY_FEE = 5_000_000; // 5 USDC
    uint256 public constant CCTP_V2_HEADER_LENGTH = 148;
    uint256 public constant BURN_MESSAGE_V2_LENGTH = 228;
    uint256 public constant HOOK_DATA_LENGTH = 64;
    uint256 public constant CCTP_V2_RELAY_MESSAGE_LENGTH = 440;
    uint32 public constant CCTP_MESSAGE_VERSION = 1;
    uint32 public constant BURN_MESSAGE_VERSION = 1;

    // Offsets are zero-indexed from the beginning of a CCTP V2 message.
    uint256 private constant _DESTINATION_CALLER_OFFSET = 108;
    uint256 private constant _BURN_BODY_OFFSET = 148;
    uint256 private constant _MINT_RECIPIENT_OFFSET = 184; // 148 + 36
    uint256 private constant _HOOK_RECIPIENT_OFFSET = 376; // 148 + 228
    uint256 private constant _HOOK_MAX_FEE_OFFSET = 408;   // 376 + 32

    event Relayed(address indexed recipient, uint256 grossAmount, uint256 fee);
    event RelayFeeSet(uint256 oldFee, uint256 newFee);
    event FeeRecipientSet(address oldRecipient, address newRecipient);
    event OwnershipTransferStarted(address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event Paused();
    event Unpaused();

    modifier nonReentrant() {
        require(!_locked, "GasRelayerV2: reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "GasRelayerV2: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "GasRelayerV2: paused");
        _;
    }

    constructor(
        address _usdc,
        address _messageTransmitter,
        address _feeRecipient,
        uint256 _relayFee
    ) {
        require(_usdc != address(0), "GasRelayerV2: zero usdc");
        require(_messageTransmitter != address(0), "GasRelayerV2: zero transmitter");
        require(_feeRecipient != address(0), "GasRelayerV2: zero fee recipient");
        require(_usdc.code.length != 0, "GasRelayerV2: usdc has no code");
        require(_messageTransmitter.code.length != 0, "GasRelayerV2: transmitter has no code");
        require(_relayFee <= MAX_RELAY_FEE, "GasRelayerV2: fee too high");

        usdc = _usdc;
        messageTransmitter = _messageTransmitter;
        feeRecipient = _feeRecipient;
        relayFee = _relayFee;
        owner = msg.sender;
    }

    /**
     * @notice Validate and relay an attested CCTP V2 message.
     * @dev `recipient` and `maxFee` are duplicated from hookData so an API
     *      client can retain the legacy relay ABI; both must match the
     *      authenticated source-chain hook exactly.
     */
    function relay(
        bytes calldata message,
        bytes calldata attestation,
        address recipient,
        uint256 maxFee
    ) external nonReentrant whenNotPaused {
        require(recipient != address(0), "GasRelayerV2: zero recipient");
        _validateRelayMessage(message, recipient, maxFee);
        require(relayFee <= maxFee, "GasRelayerV2: fee exceeds maxFee");

        uint256 balanceBefore = IERC20V2(usdc).balanceOf(address(this));

        // Circle's configured MessageTransmitter performs the full attestation,
        // nonce/replay, token, finality, and CCTP protocol validation.
        bool receivedMessage = IMessageTransmitterV2(messageTransmitter).receiveMessage(message, attestation);
        require(receivedMessage, "GasRelayerV2: receiveMessage failed");

        uint256 balanceAfter = IERC20V2(usdc).balanceOf(address(this));
        require(balanceAfter >= balanceBefore, "GasRelayerV2: invalid balance delta");
        uint256 received = balanceAfter - balanceBefore;
        require(received > relayFee, "GasRelayerV2: amount too small to cover fee");

        uint256 netAmount = received - relayFee;
        require(IERC20V2(usdc).transfer(feeRecipient, relayFee), "GasRelayerV2: fee transfer failed");
        require(IERC20V2(usdc).transfer(recipient, netAmount), "GasRelayerV2: net transfer failed");

        emit Relayed(recipient, received, relayFee);
    }

    /**
     * @notice Returns the version marker used to verify the intended relay
     *         protocol/configuration before a mainnet integration.
     */
    function protocolVersion() external pure returns (string memory) {
        return RELAYER_PROTOCOL_VERSION;
    }

    function _validateRelayMessage(
        bytes calldata message,
        address recipient,
        uint256 maxFee
    ) private view {
        require(
            message.length == CCTP_V2_RELAY_MESSAGE_LENGTH,
            "GasRelayerV2: invalid message length"
        );
        require(
            _uint32At(message, 0) == CCTP_MESSAGE_VERSION,
            "GasRelayerV2: invalid message version"
        );
        require(
            _uint32At(message, _BURN_BODY_OFFSET) == BURN_MESSAGE_VERSION,
            "GasRelayerV2: invalid burn version"
        );

        bytes32 relayAddress = bytes32(uint256(uint160(address(this))));
        require(
            _wordAt(message, _DESTINATION_CALLER_OFFSET) == relayAddress,
            "GasRelayerV2: invalid destination caller"
        );
        require(
            _wordAt(message, _MINT_RECIPIENT_OFFSET) == relayAddress,
            "GasRelayerV2: invalid mint recipient"
        );
        require(
            _wordAt(message, _HOOK_RECIPIENT_OFFSET) == bytes32(uint256(uint160(recipient))),
            "GasRelayerV2: recipient does not match hook"
        );
        require(
            uint256(_wordAt(message, _HOOK_MAX_FEE_OFFSET)) == maxFee,
            "GasRelayerV2: maxFee does not match hook"
        );
    }

    function _uint32At(bytes calldata data, uint256 offset) private pure returns (uint32) {
        return uint32(uint256(_wordAt(data, offset)) >> 224);
    }

    function _wordAt(bytes calldata data, uint256 offset) private pure returns (bytes32 word) {
        assembly ("memory-safe") {
            word := calldataload(add(data.offset, offset))
        }
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setRelayFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_RELAY_FEE, "GasRelayerV2: fee too high");
        emit RelayFeeSet(relayFee, newFee);
        relayFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "GasRelayerV2: zero address");
        emit FeeRecipientSet(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GasRelayerV2: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "GasRelayerV2: not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /**
     * @notice Rescue non-USDC ERC-20 tokens accidentally sent to this contract.
     * @dev USDC is intentionally unrecoverable by the owner. A failed relay
     *      reverts atomically, while successful relay funds are paid immediately.
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "GasRelayerV2: zero address");
        require(token != usdc, "GasRelayerV2: cannot rescue USDC");
        require(IERC20V2(token).transfer(to, amount), "GasRelayerV2: rescue failed");
    }
}