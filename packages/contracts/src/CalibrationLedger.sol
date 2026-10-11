// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CalibrationLedger: commit-reveal forecasts scored by Brier on resolution.
contract CalibrationLedger {
    struct Commit {
        address agent;
        bytes32 marketKey;
        bytes32 commitment;
        uint64 blockNumber;
        uint64 ts;
        uint16 probabilityBps;
        bytes32 reasoningHash;
        uint8 state; // 0 sealed, 1 revealed, 2 scored
    }

    struct Stats {
        uint32 count;
        uint256 brierSumBps2;
    }

    address public resolver;
    Commit[] public commits;
    mapping(bytes32 => uint256[]) internal byMarket;
    mapping(bytes32 => bool) public resolved;
    mapping(bytes32 => bool) public outcomeOf;
    mapping(address => Stats) internal stats;

    event Committed(uint256 id, address agent, bytes32 marketKey, bytes32 commitment, uint64 blockNumber);
    event Revealed(uint256 id, uint16 probabilityBps, bytes32 reasoningHash);
    event Scored(uint256 id, address agent, bool outcomeYes, uint256 brierBps2);
    event ResolverChanged(address resolver);

    error NotResolver();
    error NotAgent();
    error BadState();
    error BadReveal();
    error AlreadyResolved();
    error BadProbability();

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    constructor(address resolver_) {
        resolver = resolver_;
    }

    function setResolver(address r) external onlyResolver {
        resolver = r;
        emit ResolverChanged(r);
    }

    function commit(bytes32 marketKey, bytes32 commitment) external returns (uint256 id) {
        if (resolved[marketKey]) revert AlreadyResolved();
        id = commits.length;
        commits.push(Commit(msg.sender, marketKey, commitment, uint64(block.number), uint64(block.timestamp), 0, bytes32(0), 0));
        byMarket[marketKey].push(id);
        emit Committed(id, msg.sender, marketKey, commitment, uint64(block.number));
    }

    function reveal(uint256 id, uint16 probabilityBps, bytes32 reasoningHash, bytes32 salt) external {
        Commit storage c = commits[id];
        if (c.agent != msg.sender) revert NotAgent();
        if (c.state != 0) revert BadState();
        if (probabilityBps > 10_000) revert BadProbability();
        if (keccak256(abi.encode(c.marketKey, probabilityBps, reasoningHash, salt)) != c.commitment) revert BadReveal();
        c.probabilityBps = probabilityBps;
        c.reasoningHash = reasoningHash;
        c.state = 1;
        emit Revealed(id, probabilityBps, reasoningHash);
    }

    /// Scores every revealed commit on the key. Sealed commits that were never revealed stay unscored.
    function resolve(bytes32 marketKey, bool outcomeYes) external onlyResolver {
        if (resolved[marketKey]) revert AlreadyResolved();
        resolved[marketKey] = true;
        outcomeOf[marketKey] = outcomeYes;
        uint256[] storage ids = byMarket[marketKey];
        uint256 y = outcomeYes ? 10_000 : 0;
        for (uint256 i = 0; i < ids.length; i++) {
            Commit storage c = commits[ids[i]];
            if (c.state != 1) continue;
            uint256 p = c.probabilityBps;
            uint256 d = p > y ? p - y : y - p;
            uint256 brier = d * d;
            c.state = 2;
            Stats storage s = stats[c.agent];
            s.count += 1;
            s.brierSumBps2 += brier;
            emit Scored(ids[i], c.agent, outcomeYes, brier);
        }
    }

    function calibration(address agent) external view returns (uint32 count, uint256 brierSumBps2, uint256 meanBrierBps2) {
        Stats storage s = stats[agent];
        count = s.count;
        brierSumBps2 = s.brierSumBps2;
        meanBrierBps2 = count == 0 ? 0 : brierSumBps2 / count;
    }

    function commitCount() external view returns (uint256) {
        return commits.length;
    }

    function commitsFor(bytes32 marketKey) external view returns (uint256[] memory) {
        return byMarket[marketKey];
    }
}
