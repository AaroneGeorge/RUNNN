// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Kalikkam entry pool (hackathon demo, Arc Testnet only)
/// @notice Players pay a fixed entry in native USDC to join a round; the game server (operator) pays the pot to the
/// round's winners when it ends, or refunds everyone. Winners must be players who paid into that round, so the
/// operator can split the pot but can't send it anywhere else. Test network only: no real money.
contract KalikkamEntryPool {
    address public immutable operator;
    uint256 public immutable entryFee;

    struct Round {
        uint256 pot;
        uint32 players;
        bool closed;
    }

    mapping(bytes32 => Round) public rounds;
    mapping(bytes32 => mapping(address => bool)) public joined;

    event Joined(bytes32 indexed round, address indexed player, uint256 pot);
    event Paid(bytes32 indexed round, address indexed winner, uint256 amount);
    event Refunded(bytes32 indexed round, address indexed player, uint256 amount);

    error WrongAmount();
    error AlreadyJoined();
    error RoundClosed();
    error NotOperator();
    error NotAPlayer(address who);
    error SplitMismatch();
    error TransferFailed();

    constructor(uint256 fee) {
        operator = msg.sender;
        entryFee = fee;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Pay the entry for `round` from your own wallet.
    function join(bytes32 round) external payable {
        Round storage r = rounds[round];
        if (r.closed) revert RoundClosed();
        if (msg.value != entryFee) revert WrongAmount();
        if (joined[round][msg.sender]) revert AlreadyJoined();
        joined[round][msg.sender] = true;
        r.pot += msg.value;
        r.players += 1;
        emit Joined(round, msg.sender, r.pot);
    }

    /// @notice Pay the whole pot to `winners` (each must have paid in), `amounts` summing to the pot.
    function settle(bytes32 round, address[] calldata winners, uint256[] calldata amounts) external onlyOperator {
        Round storage r = rounds[round];
        if (r.closed) revert RoundClosed();
        if (winners.length != amounts.length) revert SplitMismatch();
        uint256 total;
        for (uint256 i; i < winners.length; i++) {
            if (!joined[round][winners[i]]) revert NotAPlayer(winners[i]);
            total += amounts[i];
        }
        if (total != r.pot) revert SplitMismatch();
        r.closed = true; // before any transfer: no second payout, even by re-entry
        r.pot = 0;
        for (uint256 i; i < winners.length; i++) {
            (bool ok, ) = winners[i].call{value: amounts[i]}("");
            if (!ok) revert TransferFailed();
            emit Paid(round, winners[i], amounts[i]);
        }
    }

    /// @notice Give every listed player their entry back (cancelled round, or nobody scored).
    function refund(bytes32 round, address[] calldata players) external onlyOperator {
        Round storage r = rounds[round];
        if (r.closed) revert RoundClosed();
        if (players.length * entryFee != r.pot) revert SplitMismatch();
        r.closed = true;
        r.pot = 0;
        for (uint256 i; i < players.length; i++) {
            if (!joined[round][players[i]]) revert NotAPlayer(players[i]);
            joined[round][players[i]] = false;
            (bool ok, ) = players[i].call{value: entryFee}("");
            if (!ok) revert TransferFailed();
            emit Refunded(round, players[i], entryFee);
        }
    }
}
