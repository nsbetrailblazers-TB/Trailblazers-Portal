-- Allows a signed-in member to update their own editable portal profile fields.
-- Cohort, program status, points, one-on-one progress, and strikes are not part
-- of this function and remain director-managed.

create or replace function public.update_my_profile(
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_uf_email text,
  p_major text,
  p_minor text,
  p_college text,
  p_graduation_year integer,
  p_preferred_contact_method text,
  p_birthday_month integer,
  p_birthday_day integer,
  p_organizations text,
  p_career_interests text
)
returns public.members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_member public.members;
begin
  if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then
    raise exception 'First and last name are required.';
  end if;

  if p_uf_email is null or p_uf_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Provide a valid portal email address.';
  end if;

  if p_graduation_year is not null and p_graduation_year not between 2020 and 2100 then
    raise exception 'Provide a valid graduation year.';
  end if;

  if (p_birthday_month is null) <> (p_birthday_day is null)
    or p_birthday_month is not null and (p_birthday_month not between 1 and 12 or p_birthday_day not between 1 and 31) then
    raise exception 'Provide a valid birthday month and day.';
  end if;

  update public.members
  set
    first_name = trim(p_first_name),
    last_name = trim(p_last_name),
    preferred_name = nullif(trim(p_preferred_name), ''),
    uf_email = lower(trim(p_uf_email)),
    major = nullif(trim(p_major), ''),
    minor = nullif(trim(p_minor), ''),
    college = nullif(trim(p_college), ''),
    graduation_year = p_graduation_year,
    preferred_contact_method = nullif(trim(p_preferred_contact_method), ''),
    birthday_month = p_birthday_month,
    birthday_day = p_birthday_day,
    organizations = nullif(trim(p_organizations), ''),
    career_interests = nullif(trim(p_career_interests), '')
  where auth_user_id = auth.uid()
  returning * into updated_member;

  if not found then
    raise exception 'No member profile is linked to this account.';
  end if;

  return updated_member;
end;
$$;

revoke all on function public.update_my_profile(
  text, text, text, text, text, text, text, integer, text, integer, integer, text, text
) from public;

grant execute on function public.update_my_profile(
  text, text, text, text, text, text, text, integer, text, integer, integer, text, text
) to authenticated;
