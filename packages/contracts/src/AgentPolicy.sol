// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPolicy: the human principal's on-chain leash for a trading agent.
contract AgentPolicy {
    struct Policy {
        uint128 maxNotionalPerTrade; // USD cents
        uint128 maxDailyNotional; // USD cents
        uint16 minEdgeBps;
        uint32 allowedCategoryMask;
        bool paused;
    }

    address public owner;
    mapping(address => Policy) public policies;
    mapping(address => mapping(uint32 => uint256)) public spentByDay;

    event PolicySet(address agent, uint128 maxNotionalPerTrade, uint128 maxDailyNotional, uint16 minEdgeBps, uint32 allowedCategoryMask, bool paused);
    event TradeRecorded(address agent, bytes32 marketKey, uint256 notional, uint16 edgeBps, bytes32 orderIdHash, uint32 dayBucket);

    error NotOwner();
    error PolicyViolation(string reason);

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

    function recordTrade(bytes32 marketKey, uint256 notional, uint16 edgeBps, uint8 category, bytes32 orderIdHash) external {
        (bool ok, string memory reason) = check(msg.sender, notional, edgeBps, category);
        if (!ok) revert PolicyViolation(reason);
        uint32 day = dayBucket();
        spentByDay[msg.sender][day] += notional;
        emit TradeRecorded(msg.sender, marketKey, notional, edgeBps, orderIdHash, day);
    }
}
