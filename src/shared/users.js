export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    isSeller: Boolean(user.is_seller),
    createdAt: user.created_at,
  };
}
