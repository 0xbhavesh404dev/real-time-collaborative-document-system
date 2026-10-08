export default function UserList({ members = [], onlineUsers = [] }) {
  const onlineIds = new Set(onlineUsers.map((user) => user.id));
  return (
    <section className="panel member-panel">
      <div className="panel-heading"><div><p className="eyebrow">PEOPLE</p><h2>Members</h2></div><span className="count-badge">{onlineUsers.length} online</span></div>
      <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className={`status-dot ${onlineIds.has(member.id) ? 'online' : ''}`} /><span className="member-name">{member.username}</span><span className="role-badge">{member.role}</span></div>)}</div>
    </section>
  );
}
