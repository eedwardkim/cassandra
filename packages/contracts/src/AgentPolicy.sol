// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPolicy: on-chain spending limits a human owner sets for a trading agent.
contract AgentPolicy {
    struct Policy {
        uint128 maxNotionalPerTrade; // USD cents
        uint128 maxDailyNotional; // USD cents
        uint16 minEdgeBps;
        uint32 allowedCategoryMask;
        bool paused;
    }

    enum TradeState { None, Authorized, Settled }

    struct Trade {
        address agent;
        bytes32 marketKey;
        uint128 notional;
        uint16 edgeBps;
        uint32 day;
        bytes32 clientOrderIdHash;
        TradeState state;
    }

    address public owner;
    Trade[] public trades;
    mapping(address => Policy) public policies;
    mapping(address => mapping(uint32 => uint256)) public spentByDay;

    event PolicySet(address agent, uint128 maxNotionalPerTrade, uint128 maxDailyNotional, uint16 minEdgeBps, uint32 allowedCategoryMask, bool paused);
    event OwnershipTransferred(address previousOwner, address newOwner);
    event TradeAuthorized(uint256 tradeId, address agent, bytes32 marketKey, uint256 notional, uint16 edgeBps, bytes32 clientOrderIdHash, uint32 dayBucket);
    event TradeRecorded(address agent, bytes32 marketKey, uint256 notional, uint16 edgeBps, bytes32 orderIdHash, uint32 dayBucket);

    error NotOwner();
    error PolicyViolation(string reason);
    error NotAgent();
    error BadState();
    error OverFilled();
    error UnknownTrade();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        owner = owner_;
    }

    function setPolicy(address agent, Policy calldata p) external onlyOwner {
        policies[agent] = p;
        emit PolicySet(agent, p.maxNotionalPerTrade, p.maxDailyNotional, p.minEdgeBps, p.allowedCategoryMask, p.paused);
    }

    function dayBucket() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function spentToday(address agent) external view returns (uint256) {
        return spentByDay[agent][dayBucket()];
    }

    function check(address agent, uint256 notional, uint16 edgeBps, uint8 category) public view returns (bool ok, string memory reason) {
        Policy memory p = policies[agent];
        if (p.maxDailyNotional == 0) return (false, "no policy set for agent");
        if (p.paused) return (false, "agent paused by owner");
        if (category >= 32 || (p.allowedCategoryMask & (uint32(1) << category)) == 0) return (false, "category not allowed");
        if (edgeBps < p.minEdgeBps) return (false, "edge below policy minimum");
        if (notional > p.maxNotionalPerTrade) return (false, "notional exceeds max per trade");
        if (spentByDay[agent][dayBucket()] + notional > p.maxDailyNotional) return (false, "daily notional limit reached");
        return (true, "ok");
    }

    /// Reserve budget before any order exists. Reverts PolicyViolation(reason) if out of policy.
    function authorizeTrade(bytes32 marketKey, uint256 notional, uint16 edgeBps, uint8 category, bytes32 clientOrderIdHash) external returns (uint256 tradeId) {
        (bool ok, string memory reason) = check(msg.sender, notional, edgeBps, category);
        if (!ok) revert PolicyViolation(reason);
        uint32 day = dayBucket();
        spentByDay[msg.sender][day] += notional;
        tradeId = trades.length;
        trades.push(Trade(msg.sender, marketKey, uint128(notional), edgeBps, day, clientOrderIdHash, TradeState.Authorized));
        emit TradeAuthorized(tradeId, msg.sender, marketKey, notional, edgeBps, clientOrderIdHash, day);
    }

    /// Close an authorization with the exchange order id; unfilled notional goes back to that day's budget.
    function settleTrade(uint256 tradeId, bytes32 orderIdHash, uint256 filledNotional) external {
        if (tradeId >= trades.length) revert UnknownTrade();
        Trade storage t = trades[tradeId];
        if (t.agent != msg.sender) revert NotAgent();
        if (t.state != TradeState.Authorized) revert BadState();
        if (filledNotional > t.notional) revert OverFilled();
        spentByDay[msg.sender][t.day] -= t.notional - filledNotional;
        t.state = TradeState.Settled;
        emit TradeRecorded(msg.sender, t.marketKey, filledNotional, t.edgeBps, orderIdHash, t.day);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPaused(address agent, bool paused) external onlyOwner {
        Policy storage p = policies[agent];
        p.paused = paused;
        emit PolicySet(agent, p.maxNotionalPerTrade, p.maxDailyNotional, p.minEdgeBps, p.allowedCategoryMask, paused);
    }

    function tradeCount() external view returns (uint256) {
        return trades.length;
    }
}
