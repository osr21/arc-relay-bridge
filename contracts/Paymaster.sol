// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title Paymaster
 * @notice USDC-funded gas sponsorship vault. Users pre-deposit USDC so they never
 *         need native tokens to transact — a trusted relayer pays gas and deducts
 *         the USDC equivalent from the user's on-chain balance.
 *
 * Flow
 * ────
 *   1. User calls deposit(amount) to top up their USDC gas balance.
 *   2. User submits a signed meta-transaction to the off-chain relayer API.
 *   3. Relayer executes the transaction on-chain (paying native gas).
 *   4. Relayer calls deductGas(user, usdcCost) — deducts from user's balance
 *      and sends usdcCost to feeRecipient.
 *   5. User calls withdraw(amount) any time to reclaim unspent USDC.
 *
 * Security properties
 * ───────────────────
 *   - Only the owner-designated relayer may call deductGas.
 *   - deductGas is capped at MAX_DEDUCTION_PER_TX (10 USDC) per call.
 *   - Reentrancy lock on deposit, withdraw, and deductGas.
 *   - Emergency pause (owner only).
 *   - Two-step ownership transfer.
 *   - rescueTokens for accidentally sent tokens.
 */
contract Paymaster {
    address public immutable usdc;

    address public owner;
    address public pendingOwner;
    address public relayer;
    address public feeRecipient;

    /**
     * @notice USDC cost per unit of gas (6-decimal units).
     *         Example: gasRate=2 means 0.000002 USDC per gas unit
     *         (≈ 20 gwei at $1 ETH/USD — adjust per chain).
     *         Frontend uses this value to estimate sponsorship cost before deposit.
     */
    uint256 public gasRate;

    bool public paused;
    bool private _locked;

    /// @dev Hard cap: 10 USDC per deductGas call.
    uint256 public constant MAX_DEDUCTION_PER_TX = 10_000_000;

    /// @dev Hard cap on gasRate: 1 USDC per gas unit (prevents absurd rates from confusing UIs).
    uint256 public constant MAX_GAS_RATE = 1_000_000;

    mapping(address => uint256) public balances;

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 remaining);
    event GasSponsored(address indexed user, uint256 usdcDeducted, uint256 remainingBalance);
    event RelayerSet(address indexed oldRelayer, address indexed newRelayer);
    event FeeRecipientSet(address indexed oldRecipient, address indexed newRecipient);
    event GasRateSet(uint256 oldRate, uint256 newRate);
    event OwnershipTransferStarted(address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event Paused();
    event Unpaused();

    modifier onlyOwner() {
        require(msg.sender == owner, "Paymaster: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Paymaster: not relayer");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "Paymaster: reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    modifier whenNotPaused() {
        require(!paused, "Paymaster: paused");
        _;
    }

    /**
     * @param _usdc          USDC token on this chain (6-decimal ERC-20).
     * @param _relayer       Trusted relayer address allowed to call deductGas.
     * @param _feeRecipient  Wallet that receives USDC deducted for gas costs.
     * @param _gasRate       Initial USDC-per-gas-unit rate (6 decimals).
     */
    constructor(
        address _usdc,
        address _relayer,
        address _feeRecipient,
        uint256 _gasRate
    ) {
        require(_usdc         != address(0), "Paymaster: zero usdc");
        require(_relayer      != address(0), "Paymaster: zero relayer");
        require(_feeRecipient != address(0), "Paymaster: zero fee recipient");

        usdc         = _usdc;
        relayer      = _relayer;
        feeRecipient = _feeRecipient;
        gasRate      = _gasRate;
        owner        = msg.sender;
    }

    // ── User functions ───────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC to fund gas sponsorship for this wallet.
     * @param amount USDC amount (6 decimals).
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Paymaster: zero amount");
        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), amount),
            "Paymaster: transferFrom failed"
        );
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount, balances[msg.sender]);
    }

    /**
     * @notice Withdraw unspent USDC from your gas balance.
     * @param amount USDC to withdraw. Pass type(uint256).max to withdraw everything.
     */
    function withdraw(uint256 amount) external nonReentrant {
        uint256 bal = balances[msg.sender];
        if (amount == type(uint256).max) amount = bal;
        require(amount > 0,       "Paymaster: zero amount");
        require(bal   >= amount,  "Paymaster: insufficient balance");
        balances[msg.sender] = bal - amount;
        require(
            IERC20(usdc).transfer(msg.sender, amount),
            "Paymaster: transfer failed"
        );
        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    // ── Relayer functions ─────────────────────────────────────────────────────

    /**
     * @notice Deduct USDC from a user's deposit to reimburse the relayer for gas.
     *         Called by the trusted relayer after executing a sponsored transaction.
     * @param user      Wallet whose balance to deduct.
     * @param usdcCost  Gas cost denominated in USDC (6 decimals). Max 10 USDC.
     */
    function deductGas(address user, uint256 usdcCost)
        external
        nonReentrant
        onlyRelayer
        whenNotPaused
    {
        require(user     != address(0),          "Paymaster: zero user");
        require(usdcCost  > 0,                   "Paymaster: zero cost");
        require(usdcCost <= MAX_DEDUCTION_PER_TX, "Paymaster: exceeds cap");
        require(balances[user] >= usdcCost,       "Paymaster: user underfunded");

        balances[user] -= usdcCost;
        require(
            IERC20(usdc).transfer(feeRecipient, usdcCost),
            "Paymaster: fee transfer failed"
        );
        emit GasSponsored(user, usdcCost, balances[user]);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Paymaster: zero address");
        emit RelayerSet(relayer, newRelayer);
        relayer = newRelayer;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Paymaster: zero address");
        emit FeeRecipientSet(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setGasRate(uint256 newRate) external onlyOwner {
        require(newRate <= MAX_GAS_RATE, "Paymaster: rate exceeds max");
        emit GasRateSet(gasRate, newRate);
        gasRate = newRate;
    }

    function pause()   external onlyOwner { paused = true;  emit Paused(); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(); }

    /// @notice Initiate two-step ownership transfer.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Paymaster: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(newOwner);
    }

    /// @notice Complete ownership transfer — must be called by the new owner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Paymaster: not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner        = pendingOwner;
        pendingOwner = address(0);
    }

    /**
     * @notice Rescue ERC-20 tokens accidentally sent to this contract.
     *         Explicitly blocks rescue of the USDC token to protect user deposits.
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        require(to    != address(0), "Paymaster: zero address");
        require(token != usdc,       "Paymaster: cannot rescue USDC deposits");
        require(IERC20(token).transfer(to, amount), "Paymaster: rescue failed");
    }
}
